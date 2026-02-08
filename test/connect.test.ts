/**
 * Watchtower SDK - Connect & Room Tests
 * Tests for the new simplified connect() API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect, Room, ConnectOptions, Player, MessageMeta } from '../src/index'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock WebSocket with controllable behavior
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static CONNECTING = 0
  
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: any) => void) | null = null
  
  constructor(public url: string) {
    // Store instance for test access
    MockWebSocket.lastInstance = this
  }
  
  // Simulate successful connection with welcome message
  simulateOpen(welcomeData?: Partial<{ hostId: string; players: Player[] }>) {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
    // Send welcome message
    const welcome = {
      type: 'welcome',
      hostId: welcomeData?.hostId || 'p_testplayer',
      players: welcomeData?.players || []
    }
    this.onmessage?.({ data: JSON.stringify(welcome) })
  }
  
  simulateMessage(msg: any) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  
  simulateError() {
    this.onerror?.({})
  }
  
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
  
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  })
  
  static lastInstance: MockWebSocket | null = null
}

global.WebSocket = MockWebSocket as any

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key]
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  })
}
global.localStorage = localStorageMock as any

describe('connect()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockFetch.mockReset()
    MockWebSocket.lastInstance = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Connection', () => {
    it('should connect to a room with explicit roomId', async () => {
      const connectPromise = connect('test-room')
      
      // Wait for WebSocket to be created
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen()
      
      const room = await connectPromise
      expect(room).toBeInstanceOf(Room)
      expect(room.code).toBe('test-room')
    })

    it('should auto-generate roomId when not provided', async () => {
      const connectPromise = connect()
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen()
      
      const room = await connectPromise
      expect(room.code).toMatch(/^[A-Z0-9]{6}$/)
    })

    it('should use provided playerId', async () => {
      const connectPromise = connect('test-room', { playerId: 'custom-player' })
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen({ hostId: 'custom-player' })
      
      const room = await connectPromise
      expect(room.playerId).toBe('custom-player')
    })

    it('should generate and persist playerId in localStorage', async () => {
      const connectPromise = connect('test-room')
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen()
      
      const room = await connectPromise
      expect(room.playerId).toMatch(/^p_[a-z0-9]+$/)
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'watchtower_player_id',
        room.playerId
      )
    })

    it('should reuse playerId from localStorage', async () => {
      localStorageMock.store['watchtower_player_id'] = 'p_stored123'
      
      const connectPromise = connect('test-room')
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen({ hostId: 'p_stored123' })
      
      const room = await connectPromise
      expect(room.playerId).toBe('p_stored123')
    })

    it('should include player name and meta in connection URL', async () => {
      const connectPromise = connect('test-room', {
        name: 'TestPlayer',
        meta: { avatar: 'knight', color: '#ff0000' }
      })
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      
      const url = MockWebSocket.lastInstance!.url
      expect(url).toContain('name=TestPlayer')
      expect(url).toContain('meta=')
      expect(url).toContain(encodeURIComponent(JSON.stringify({ avatar: 'knight', color: '#ff0000' })))
      
      MockWebSocket.lastInstance!.simulateOpen()
      await connectPromise
    })

    it('should use custom apiUrl', async () => {
      const connectPromise = connect('test-room', {
        apiUrl: 'https://custom-api.example.com'
      })
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      
      const url = MockWebSocket.lastInstance!.url
      expect(url).toContain('wss://custom-api.example.com')
      
      MockWebSocket.lastInstance!.simulateOpen()
      await connectPromise
    })
  })

  describe('Connection Errors', () => {
    it('should reject on WebSocket error', async () => {
      const connectPromise = connect('test-room')
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateError()
      
      await expect(connectPromise).rejects.toThrow('WebSocket connection failed')
    })

    it('should reject on connection timeout', async () => {
      vi.useFakeTimers()
      
      const connectPromise = connect('test-room')
      
      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      
      // Advance past the 10s timeout without sending welcome
      vi.advanceTimersByTime(11000)
      
      await expect(connectPromise).rejects.toThrow('Connection timeout')
      
      vi.useRealTimers()
    })
  })
})

describe('Room', () => {
  let room: Room
  let ws: MockWebSocket
  
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockFetch.mockReset()
    MockWebSocket.lastInstance = null
    
    const connectPromise = connect('test-room', { playerId: 'p_test' })
    await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
    ws = MockWebSocket.lastInstance!
    ws.simulateOpen({ 
      hostId: 'p_test',
      players: [{ id: 'p_test', name: 'TestPlayer', joinedAt: Date.now() }]
    })
    room = await connectPromise
  })

  afterEach(() => {
    room?.leave()
    vi.restoreAllMocks()
  })

  describe('Room Properties', () => {
    it('should have correct code', () => {
      expect(room.code).toBe('test-room')
    })

    it('should have correct playerId', () => {
      expect(room.playerId).toBe('p_test')
    })

    it('should track hostId from welcome message', () => {
      expect(room.hostId).toBe('p_test')
    })

    it('should correctly identify if player is host', () => {
      expect(room.isHost).toBe(true)
    })

    it('should track players from welcome message', () => {
      expect(room.players).toHaveLength(1)
      expect(room.players[0].id).toBe('p_test')
    })

    it('should track playerCount', () => {
      expect(room.playerCount).toBe(1)
    })

    it('should track connected state', () => {
      expect(room.connected).toBe(true)
    })
  })

  describe('Messaging', () => {
    it('should broadcast to all players', () => {
      room.broadcast({ x: 100, y: 200 })
      
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'broadcast',
        data: { x: 100, y: 200 }
      }))
    })

    it('should send direct message to specific player', () => {
      room.send('p_other', { action: 'attack', damage: 10 })
      
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'direct',
        to: 'p_other',
        data: { action: 'attack', damage: 10 }
      }))
    })

    it('should not send when WebSocket is closed', () => {
      ws.readyState = MockWebSocket.CLOSED
      
      room.broadcast({ test: true })
      
      expect(ws.send).not.toHaveBeenCalled()
    })
  })

  describe('Events', () => {
    it('should emit message event on broadcast', () => {
      const handler = vi.fn()
      room.on('message', handler)
      
      ws.simulateMessage({
        type: 'broadcast',
        from: 'p_other',
        data: { x: 50, y: 50 },
        serverTime: 1234567890,
        tick: 42
      })
      
      expect(handler).toHaveBeenCalledWith(
        'p_other',
        { x: 50, y: 50 },
        { serverTime: 1234567890, tick: 42 }
      )
    })

    it('should emit message event on direct message', () => {
      const handler = vi.fn()
      room.on('message', handler)
      
      ws.simulateMessage({
        type: 'direct',
        from: 'p_other',
        data: { secret: 'hello' },
        serverTime: 1234567890,
        tick: 100
      })
      
      expect(handler).toHaveBeenCalledWith(
        'p_other',
        { secret: 'hello' },
        { serverTime: 1234567890, tick: 100 }
      )
    })

    it('should emit join event when player joins', () => {
      const handler = vi.fn()
      room.on('join', handler)
      
      ws.simulateMessage({
        type: 'join',
        playerId: 'p_newplayer',
        name: 'NewPlayer',
        meta: { avatar: 'wizard' },
        joinedAt: 1234567890
      })
      
      expect(handler).toHaveBeenCalledWith({
        id: 'p_newplayer',
        name: 'NewPlayer',
        meta: { avatar: 'wizard' },
        joinedAt: 1234567890
      })
      
      // Should also update players list
      expect(room.players).toHaveLength(2)
      expect(room.playerCount).toBe(2)
    })

    it('should emit leave event when player leaves', () => {
      // First add a player
      ws.simulateMessage({
        type: 'join',
        playerId: 'p_leaving',
        name: 'LeavingPlayer',
        joinedAt: Date.now()
      })
      
      const handler = vi.fn()
      room.on('leave', handler)
      
      ws.simulateMessage({
        type: 'leave',
        playerId: 'p_leaving'
      })
      
      expect(handler).toHaveBeenCalled()
      expect(handler.mock.calls[0][0].id).toBe('p_leaving')
      
      // Should remove from players list
      const playerIds = room.players.map(p => p.id)
      expect(playerIds).not.toContain('p_leaving')
    })

    it('should emit disconnected event on WebSocket close', () => {
      const handler = vi.fn()
      room.on('disconnected', handler)
      
      ws.simulateClose()
      
      expect(handler).toHaveBeenCalled()
      expect(room.connected).toBe(false)
    })

    it('should allow removing event listeners', () => {
      const handler = vi.fn()
      room.on('message', handler)
      room.off('message', handler)
      
      ws.simulateMessage({
        type: 'broadcast',
        from: 'p_other',
        data: { test: true },
        serverTime: Date.now(),
        tick: 1
      })
      
      expect(handler).not.toHaveBeenCalled()
    })

    it('should update hostId on host_changed event', () => {
      ws.simulateMessage({
        type: 'host_changed',
        hostId: 'p_newhost'
      })
      
      expect(room.hostId).toBe('p_newhost')
      expect(room.isHost).toBe(false)
    })
  })

  // Persistence tests removed - saves feature removed from SDK

  describe('Lifecycle', () => {
    it('should close WebSocket on leave', () => {
      room.leave()
      
      expect(ws.close).toHaveBeenCalled()
      expect(room.connected).toBe(false)
    })

    it('should clear players on leave', () => {
      room.leave()
      
      expect(room.players).toHaveLength(0)
      expect(room.playerCount).toBe(0)
    })
  })
})

describe('Room Class Direct Usage', () => {
  it('should allow creating Room instance directly', async () => {
    const room = new Room('direct-room', { playerId: 'p_direct' })
    
    const connectPromise = room.connect()
    
    await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
    MockWebSocket.lastInstance!.simulateOpen({ hostId: 'p_direct' })
    
    await connectPromise
    
    expect(room.code).toBe('direct-room')
    expect(room.playerId).toBe('p_direct')
    expect(room.connected).toBe(true)
    
    room.leave()
  })
})
