/**
 * Watchtower SDK - Room Unit Tests
 * Tests for the Room class and multiplayer functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Room } from '../src/index'

// Track WebSocket instances for testing
let wsInstances: MockWebSocket[] = []

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3
  
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  
  send = vi.fn()
  close = vi.fn()
  
  constructor(public url: string) {
    wsInstances.push(this)
  }
  
  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
  
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.close()
    this.onclose?.()
  }
  
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  
  simulateError() {
    this.onerror?.(new Event('error'))
  }
}

global.WebSocket = MockWebSocket as any

describe('Room', () => {
  const defaultConfig = {
    gameId: 'test-game',
    playerId: 'test-player',
    apiUrl: 'https://api.test.com',
    apiKey: 'test-key'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    wsInstances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Connection', () => {
    it('should connect with correct WebSocket URL', async () => {
      const room = new Room('ABCD', defaultConfig)
      const connectPromise = room.connect()
      
      // Simulate successful connection
      wsInstances[0].simulateOpen()
      await connectPromise
      
      expect(wsInstances[0].url).toBe(
        'wss://api.test.com/v1/rooms/ABCD/ws?playerId=test-player&apiKey=test-key'
      )
    })

    it('should convert https to wss', async () => {
      const room = new Room('TEST', {
        ...defaultConfig,
        apiUrl: 'https://secure.api.com'
      })
      
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      expect(wsInstances[0].url).toMatch(/^wss:\/\//)
    })

    it('should convert http to ws', async () => {
      const room = new Room('TEST', {
        ...defaultConfig,
        apiUrl: 'http://local.api.com'
      })
      
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      expect(wsInstances[0].url).toMatch(/^ws:\/\//)
    })

    it('should reject on connection error', async () => {
      const room = new Room('FAIL', defaultConfig)
      const connectPromise = room.connect()
      
      wsInstances[0].simulateError()
      
      await expect(connectPromise).rejects.toThrow('WebSocket connection failed')
    })

    it('should emit disconnected event on close', async () => {
      const room = new Room('TEST', defaultConfig)
      const disconnectHandler = vi.fn()
      room.on('disconnected', disconnectHandler)
      
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      wsInstances[0].simulateClose()
      
      expect(disconnectHandler).toHaveBeenCalled()
    })

    it('should report connected status', async () => {
      const room = new Room('TEST', defaultConfig)
      
      expect(room.connected).toBe(false)
      
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      expect(room.connected).toBe(true)
    })
  })

  describe('Player State', () => {
    let room: Room
    
    beforeEach(async () => {
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
    })

    it('should set player state (merge)', () => {
      room.player.set({ x: 100, y: 200 })
      room.player.set({ z: 50 })
      
      expect(room.player.get()).toEqual({ x: 100, y: 200, z: 50 })
    })

    it('should replace entire player state', () => {
      room.player.set({ x: 100, y: 200 })
      room.player.replace({ newState: true })
      
      expect(room.player.get()).toEqual({ newState: true })
    })

    it('should clear player state', () => {
      room.player.set({ x: 100 })
      room.player.clear()
      
      expect(room.player.get()).toEqual({})
    })

    it('should sync player state to server', async () => {
      vi.useFakeTimers()
      
      // Need to create room with fake timers active
      const testRoom = new Room('SYNC', defaultConfig)
      const connectPromise = testRoom.connect()
      wsInstances[wsInstances.length - 1].simulateOpen()
      await connectPromise
      
      testRoom.player.set({ x: 100 })
      
      // Wait for sync interval (50ms default)
      vi.advanceTimersByTime(60)
      
      expect(wsInstances[wsInstances.length - 1].send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'player_state', state: { x: 100 } })
      )
      
      vi.useRealTimers()
    })

    it('should only sync when dirty', async () => {
      vi.useFakeTimers()
      
      // Need to create room with fake timers active
      const testRoom = new Room('DIRTY', defaultConfig)
      const connectPromise = testRoom.connect()
      wsInstances[wsInstances.length - 1].simulateOpen()
      await connectPromise
      
      const ws = wsInstances[wsInstances.length - 1]
      
      testRoom.player.set({ x: 100 })
      vi.advanceTimersByTime(60)
      
      // First sync
      expect(ws.send).toHaveBeenCalledTimes(1)
      
      // No changes, should not sync again
      vi.advanceTimersByTime(60)
      expect(ws.send).toHaveBeenCalledTimes(1)
      
      vi.useRealTimers()
    })

    it('should force immediate sync', () => {
      room.player.set({ x: 100 })
      room.player.sync()
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'player_state', state: { x: 100 } })
      )
    })
  })

  describe('Game State (Host)', () => {
    let room: Room
    
    beforeEach(async () => {
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      // Simulate being the host
      wsInstances[0].simulateMessage({
        type: 'connected',
        playerId: 'test-player',
        room: { hostId: 'test-player', code: 'TEST' }
      })
    })

    it('should allow host to set game state', () => {
      room.state.set({ phase: 'playing' })
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'game_state', state: { phase: 'playing' } })
      )
    })

    it('should merge game state', () => {
      room.state.set({ phase: 'playing' })
      room.state.set({ round: 2 })
      
      expect(room.state.get()).toEqual({ phase: 'playing', round: 2 })
    })

    it('should replace entire game state', () => {
      room.state.set({ phase: 'playing', round: 1 })
      room.state.replace({ newGame: true })
      
      expect(room.state.get()).toEqual({ newGame: true })
    })
  })

  describe('Game State (Non-Host)', () => {
    let room: Room
    let consoleWarn: any
    
    beforeEach(async () => {
      consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      // Simulate NOT being the host
      wsInstances[0].simulateMessage({
        type: 'connected',
        playerId: 'test-player',
        room: { hostId: 'other-player', code: 'TEST' }
      })
    })

    it('should warn when non-host tries to set state', () => {
      room.state.set({ phase: 'cheating' })
      
      expect(consoleWarn).toHaveBeenCalledWith('Only the host can set game state')
    })

    it('should not send state when non-host', () => {
      room.state.set({ phase: 'cheating' })
      
      // send should only have been called during player sync, not for game state
      const calls = wsInstances[0].send.mock.calls
      const gameStateCalls = calls.filter(
        (c: any) => JSON.parse(c[0]).type === 'game_state'
      )
      expect(gameStateCalls).toHaveLength(0)
    })
  })

  describe('Message Handling', () => {
    let room: Room
    
    beforeEach(async () => {
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
    })

    it('should emit connected event with room info', () => {
      const handler = vi.fn()
      room.on('connected', handler)
      
      wsInstances[0].simulateMessage({
        type: 'connected',
        playerId: 'test-player',
        room: { code: 'TEST', hostId: 'test-player', playerCount: 1 }
      })
      
      expect(handler).toHaveBeenCalledWith({
        playerId: 'test-player',
        room: expect.objectContaining({ code: 'TEST' })
      })
    })

    it('should emit playerJoined event', () => {
      const handler = vi.fn()
      room.on('playerJoined', handler)
      
      wsInstances[0].simulateMessage({
        type: 'player_joined',
        playerId: 'new-player',
        playerCount: 2
      })
      
      expect(handler).toHaveBeenCalledWith('new-player', 2)
    })

    it('should emit playerLeft event and update players', () => {
      const leftHandler = vi.fn()
      const playersHandler = vi.fn()
      room.on('playerLeft', leftHandler)
      room.on('players', playersHandler)
      
      // First set some players
      wsInstances[0].simulateMessage({
        type: 'players_sync',
        players: { 'player1': { x: 0 }, 'player2': { x: 100 } }
      })
      
      // Then one leaves
      wsInstances[0].simulateMessage({
        type: 'player_left',
        playerId: 'player2',
        playerCount: 1
      })
      
      expect(leftHandler).toHaveBeenCalledWith('player2', 1)
      expect(playersHandler).toHaveBeenLastCalledWith({ 'player1': { x: 0 } })
    })

    it('should emit state event on game state sync', () => {
      const handler = vi.fn()
      room.on('state', handler)
      
      wsInstances[0].simulateMessage({
        type: 'game_state_sync',
        state: { phase: 'lobby', countdown: 10 }
      })
      
      expect(handler).toHaveBeenCalledWith({ phase: 'lobby', countdown: 10 })
    })

    it('should emit hostChanged event', () => {
      const handler = vi.fn()
      room.on('hostChanged', handler)
      
      // Initial connection
      wsInstances[0].simulateMessage({
        type: 'connected',
        room: { hostId: 'player1' }
      })
      
      // Host changes
      wsInstances[0].simulateMessage({
        type: 'host_changed',
        hostId: 'player2'
      })
      
      expect(handler).toHaveBeenCalledWith('player2')
      expect(room.hostId).toBe('player2')
    })

    it('should emit message event on broadcast', () => {
      const handler = vi.fn()
      room.on('message', handler)
      
      wsInstances[0].simulateMessage({
        type: 'message',
        from: 'other-player',
        data: { type: 'explosion', x: 50, y: 50 }
      })
      
      expect(handler).toHaveBeenCalledWith('other-player', {
        type: 'explosion',
        x: 50,
        y: 50
      })
    })

    it('should handle malformed JSON gracefully', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      // Send invalid JSON
      wsInstances[0].onmessage?.({ data: 'not valid json{' })
      
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to parse WebSocket message:',
        expect.any(Error)
      )
    })

    it('should catch errors in event handlers', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      room.on('message', () => {
        throw new Error('Handler error')
      })
      
      // This should not throw
      wsInstances[0].simulateMessage({
        type: 'message',
        from: 'sender',
        data: {}
      })
      
      expect(consoleError).toHaveBeenCalledWith(
        'Error in message handler:',
        expect.any(Error)
      )
    })
  })

  describe('Broadcast & Messaging', () => {
    let room: Room
    
    beforeEach(async () => {
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
    })

    it('should broadcast to all players', () => {
      room.broadcast({ type: 'explosion' })
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'broadcast',
          data: { type: 'explosion' },
          excludeSelf: true
        })
      )
    })

    it('should broadcast including self', () => {
      room.broadcast({ type: 'gameOver' }, false)
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'broadcast',
          data: { type: 'gameOver' },
          excludeSelf: false
        })
      )
    })

    it('should send to specific player', () => {
      room.sendTo('player-123', { type: 'private' })
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'send',
          to: 'player-123',
          data: { type: 'private' }
        })
      )
    })

    it('should send ping', () => {
      room.ping()
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ping' })
      )
    })

    it('should warn when sending to disconnected socket', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      room.disconnect()
      room.broadcast({ test: true })
      
      expect(consoleWarn).toHaveBeenCalledWith('WebSocket not connected')
    })
  })

  describe('Host Transfer', () => {
    let room: Room
    
    beforeEach(async () => {
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
    })

    it('should transfer host when current host', () => {
      // Make this player the host
      wsInstances[0].simulateMessage({
        type: 'connected',
        room: { hostId: 'test-player' }
      })
      
      room.transferHost('new-host')
      
      expect(wsInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'transfer_host', newHostId: 'new-host' })
      )
    })

    it('should warn when non-host tries to transfer', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      // Make another player the host
      wsInstances[0].simulateMessage({
        type: 'connected',
        room: { hostId: 'other-player' }
      })
      
      room.transferHost('new-host')
      
      expect(consoleWarn).toHaveBeenCalledWith('Only the host can transfer host')
    })
  })

  describe('Event Subscriptions', () => {
    let room: Room
    
    beforeEach(async () => {
      room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
    })

    it('should allow multiple handlers for same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      room.on('message', handler1)
      room.on('message', handler2)
      
      wsInstances[0].simulateMessage({
        type: 'message',
        from: 'sender',
        data: 'test'
      })
      
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should unsubscribe with off', () => {
      const handler = vi.fn()
      
      room.on('message', handler)
      room.off('message', handler)
      
      wsInstances[0].simulateMessage({
        type: 'message',
        from: 'sender',
        data: 'test'
      })
      
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('Disconnect', () => {
    it('should clean up on disconnect', async () => {
      const room = new Room('TEST', defaultConfig)
      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise
      
      room.disconnect()
      
      expect(wsInstances[0].close).toHaveBeenCalled()
      expect(room.connected).toBe(false)
    })
  })
})
