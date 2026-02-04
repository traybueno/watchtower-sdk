import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Watchtower, Sync } from '../src/index'

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((err: any) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  
  sentMessages: any[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Connect synchronously via Promise.resolve().then() which works with fake timers
    Promise.resolve().then(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    })
  }

  send(data: string) {
    this.sentMessages.push(JSON.parse(data))
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  // Test helpers
  receiveMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateError() {
    this.onerror?.(new Error('Connection failed'))
  }
}

// Install mock
const originalWebSocket = global.WebSocket
beforeEach(() => {
  (global as any).WebSocket = MockWebSocket
})
afterEach(() => {
  (global as any).WebSocket = originalWebSocket
})

describe('Sync', () => {
  let wt: Watchtower
  let mockWs: MockWebSocket

  beforeEach(() => {
    wt = new Watchtower({
      gameId: 'test-game',
      playerId: 'player-1'
    })
  })

  describe('sync() creation', () => {
    it('creates a Sync instance with state', () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      expect(sync).toBeInstanceOf(Sync)
      expect(sync.state).toBe(state)
      expect(sync.myId).toBe('player-1')
    })

    it('accepts custom options', () => {
      const state = { players: {} }
      const sync = wt.sync(state, { tickRate: 30, interpolate: false })
      
      expect(sync).toBeInstanceOf(Sync)
    })
  })

  describe('join()', () => {
    it('connects to a room via WebSocket', async () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      const joinPromise = sync.join('test-room')
      
      // Wait for connection
      await joinPromise
      
      expect(sync.connected).toBe(true)
      expect(sync.roomId).toBe('test-room')
    })

    it('includes room options in WebSocket URL', async () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      await sync.join('test-room', {
        create: true,
        maxPlayers: 4,
        public: true
      })
      
      // Check the WebSocket URL contains our params
      const ws = (sync as any).ws as MockWebSocket
      expect(ws.url).toContain('create=true')
      expect(ws.url).toContain('maxPlayers=4')
      expect(ws.url).toContain('public=true')
    })

    it('emits connected event', async () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      const connectedHandler = vi.fn()
      sync.on('connected', connectedHandler)
      
      await sync.join('test-room')
      
      expect(connectedHandler).toHaveBeenCalled()
    })
  })

  describe('leave()', () => {
    it('disconnects from room', async () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      expect(sync.connected).toBe(true)
      
      await sync.leave()
      expect(sync.connected).toBe(false)
      expect(sync.roomId).toBeNull()
    })

    it('clears remote players from state', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      
      // Simulate receiving other player's state
      const ws = (sync as any).ws as MockWebSocket
      ws.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200 }
      })
      
      expect(state.players['player-2']).toBeDefined()
      
      await sync.leave()
      
      expect(state.players['player-2']).toBeUndefined()
    })

    it('keeps own player data structure', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      
      // Add ourselves
      state.players[sync.myId] = { x: 50, y: 50 }
      
      // Add another player via message
      const ws = (sync as any).ws as MockWebSocket
      ws.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200 }
      })
      
      await sync.leave()
      
      // Our data should still be there (but remote player gone)
      expect(state.players[sync.myId]).toBeDefined()
      expect(state.players['player-2']).toBeUndefined()
    })
  })

  describe('state synchronization', () => {
    it('sends own state changes to server', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state, { tickRate: 20 })
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      // Add our player
      state.players[sync.myId] = { x: 0, y: 0 }
      
      // Wait for sync interval to fire
      await new Promise(r => setTimeout(r, 100))
      
      // Check message was sent
      const stateMessages = ws.sentMessages.filter(m => m.type === 'state')
      expect(stateMessages.length).toBeGreaterThan(0)
      expect(stateMessages[0].data).toEqual({ x: 0, y: 0 })
      
      await sync.leave()
    })

    it('only sends when state changes', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state, { tickRate: 20 })
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      // Add our player
      state.players[sync.myId] = { x: 0, y: 0 }
      
      // Wait for initial sync
      await new Promise(r => setTimeout(r, 100))
      const firstCount = ws.sentMessages.length
      
      // Don't change state, wait more
      await new Promise(r => setTimeout(r, 100))
      
      // Should not have sent more messages (state unchanged)
      expect(ws.sentMessages.length).toBe(firstCount)
      
      // Now change state
      state.players[sync.myId].x = 100
      await new Promise(r => setTimeout(r, 100))
      
      // Should have sent a new message
      expect(ws.sentMessages.length).toBeGreaterThan(firstCount)
      
      await sync.leave()
    })

    it('receives and applies other players state', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      // Receive another player's state
      ws.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200, name: 'Bob' }
      })
      
      expect(state.players['player-2']).toEqual({
        x: 100,
        y: 200,
        name: 'Bob'
      })
    })

    it('handles full_state for late joiners', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      // Receive full state (as if joining existing room)
      ws.receiveMessage({
        type: 'full_state',
        state: {
          'player-2': { x: 100, y: 200 },
          'player-3': { x: 300, y: 400 }
        }
      })
      
      expect(state.players['player-2']).toEqual({ x: 100, y: 200 })
      expect(state.players['player-3']).toEqual({ x: 300, y: 400 })
    })
  })

  describe('player join/leave events', () => {
    it('emits join event when player joins', async () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      const joinHandler = vi.fn()
      sync.on('join', joinHandler)
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      ws.receiveMessage({
        type: 'join',
        playerId: 'player-2'
      })
      
      expect(joinHandler).toHaveBeenCalledWith('player-2')
    })

    it('emits leave event and removes player from state', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      const leaveHandler = vi.fn()
      sync.on('leave', leaveHandler)
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      // Add player
      ws.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200 }
      })
      
      expect(state.players['player-2']).toBeDefined()
      
      // Player leaves
      ws.receiveMessage({
        type: 'leave',
        playerId: 'player-2'
      })
      
      expect(leaveHandler).toHaveBeenCalledWith('player-2')
      expect(state.players['player-2']).toBeUndefined()
    })
  })

  describe('create()', () => {
    it('creates a room and joins it', async () => {
      const state = { players: {} }
      const sync = wt.sync(state)
      
      const code = await sync.create({ maxPlayers: 4 })
      
      expect(code).toMatch(/^[A-Z0-9]{6}$/)
      expect(sync.connected).toBe(true)
      expect(sync.roomId).toBe(code)
    })
  })

  describe('different state key names', () => {
    it('works with "entities" key', async () => {
      const state = { entities: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      ws.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200 }
      })
      
      expect(state.entities['player-2']).toEqual({ x: 100, y: 200 })
    })

    it('works with "gnomes" key', async () => {
      const state = { gnomes: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('test-room')
      const ws = (sync as any).ws as MockWebSocket
      
      ws.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200, color: 0xff0000 }
      })
      
      expect(state.gnomes['player-2']).toEqual({ x: 100, y: 200, color: 0xff0000 })
    })
  })

  describe('switching rooms', () => {
    it('leaves current room when joining new one', async () => {
      const state = { players: {} as Record<string, any> }
      const sync = wt.sync(state)
      
      await sync.join('room-1')
      
      // Add player in room 1
      const ws1 = (sync as any).ws as MockWebSocket
      ws1.receiveMessage({
        type: 'state',
        playerId: 'player-2',
        data: { x: 100, y: 200 }
      })
      
      expect(state.players['player-2']).toBeDefined()
      
      // Join different room
      await sync.join('room-2')
      
      // Old player should be gone
      expect(state.players['player-2']).toBeUndefined()
      expect(sync.roomId).toBe('room-2')
    })
  })
})

describe('Sync - Integration scenarios', () => {
  let wt: Watchtower

  beforeEach(() => {
    wt = new Watchtower({
      gameId: 'test-game',
      playerId: 'player-1'
    })
  })

  it('gnomechat-style flow works', async () => {
    // This mimics how gnomechat would use the API
    const state = { gnomes: {} as Record<string, any> }
    const sync = wt.sync(state)
    
    await sync.join('gnome-garden')
    const ws = (sync as any).ws as MockWebSocket
    
    // Add myself (like gnomechat does)
    state.gnomes[sync.myId] = {
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      color: 0xff0000
    }
    
    // Move around
    state.gnomes[sync.myId].x = 100
    state.gnomes[sync.myId].z = 50
    
    // Wait for sync
    await new Promise(r => setTimeout(r, 100))
    
    // Should have sent our state
    const sentState = ws.sentMessages.find(m => m.type === 'state')
    expect(sentState).toBeDefined()
    expect(sentState.data.x).toBe(100)
    expect(sentState.data.z).toBe(50)
    
    // Receive other gnome
    ws.receiveMessage({
      type: 'state',
      playerId: 'gnome-2',
      data: { x: 200, y: 0, z: 300, rotY: 1.5, color: 0x00ff00 }
    })
    
    // Other gnome appears in state
    expect(state.gnomes['gnome-2']).toEqual({
      x: 200, y: 0, z: 300, rotY: 1.5, color: 0x00ff00
    })
    
    // Can iterate all gnomes for rendering
    const gnomeIds = Object.keys(state.gnomes)
    expect(gnomeIds).toContain(sync.myId)
    expect(gnomeIds).toContain('gnome-2')
    
    await sync.leave()
  })

  it('game loop pattern works', async () => {
    const state = { players: {} as Record<string, any> }
    const sync = wt.sync(state, { tickRate: 60 }) // Higher tick rate for this test
    
    await sync.join('game-room')
    const ws = (sync as any).ws as MockWebSocket
    
    // Initialize player
    state.players[sync.myId] = { x: 0, y: 0, vx: 5, vy: 0 }
    
    // Simulate a few game frames
    for (let frame = 0; frame < 10; frame++) {
      const me = state.players[sync.myId]
      me.x += me.vx
      me.y += me.vy
      await new Promise(r => setTimeout(r, 16)) // ~60fps
    }
    
    // Wait a bit more for sync
    await new Promise(r => setTimeout(r, 50))
    
    // Should have synced
    const stateMessages = ws.sentMessages.filter(m => m.type === 'state')
    expect(stateMessages.length).toBeGreaterThan(0)
    
    // Final position should be sent (50 = 5 * 10 frames)
    const lastMessage = stateMessages[stateMessages.length - 1]
    expect(lastMessage.data.x).toBe(50)
    
    await sync.leave()
  })
})
