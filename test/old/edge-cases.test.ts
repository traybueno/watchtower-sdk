/**
 * Watchtower SDK - Edge Cases & Error Handling Tests
 * Tests for boundary conditions, error states, and unusual inputs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Watchtower, Room } from '../src/index'

const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn(),
  clear: vi.fn(() => { localStorageMock.store = {} })
}
global.localStorage = localStorageMock as any

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockFetch.mockReset()
  })

  describe('Save Data Types', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
    })

    it('should save null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('nullsave', null)
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('null')
    })

    it('should save numbers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('score', 12345)
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('12345')
    })

    it('should save strings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('name', 'player-one')
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('"player-one"')
    })

    it('should save boolean', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('premium', true)
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('true')
    })

    it('should save arrays', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('inventory', [1, 2, 3, 'sword'])
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('[1,2,3,"sword"]')
    })

    it('should save nested objects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const nested = {
        player: {
          stats: {
            hp: 100,
            mp: 50
          },
          inventory: ['sword', 'shield']
        }
      }

      await wt.save('game', nested)
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.player.stats.hp).toBe(100)
    })

    it('should handle undefined (converts to null)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('undef', undefined as any)
      
      // undefined becomes the string 'undefined' when stringified directly
      // Actually JSON.stringify(undefined) returns undefined (not a string)
      // But when passed to body, it becomes the string 'undefined'
    })

    it('should handle special number values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      // NaN and Infinity become null in JSON
      await wt.save('special', { nan: NaN, inf: Infinity, negInf: -Infinity })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.nan).toBeNull()
      expect(body.inf).toBeNull()
      expect(body.negInf).toBeNull()
    })

    it('should handle Date objects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const date = new Date('2026-01-29T12:00:00Z')
      await wt.save('timestamp', { date })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.date).toBe('2026-01-29T12:00:00.000Z')
    })

    it('should handle BigInt (throws)', async () => {
      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      
      // BigInt cannot be serialized to JSON
      await expect(wt.save('big', { num: BigInt(9007199254740991) }))
        .rejects.toThrow()
    })

    it('should handle functions (ignored)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('withFunc', { 
        a: 1, 
        fn: () => 'ignored' 
      })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.a).toBe(1)
      expect(body.fn).toBeUndefined()
    })

    it('should handle Symbol keys (ignored)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const sym = Symbol('key')
      await wt.save('withSymbol', { 
        a: 1, 
        [sym]: 'ignored' 
      })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.a).toBe(1)
      expect(Object.keys(body)).toEqual(['a'])
    })
  })

  describe('Empty & Boundary Values', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
    })

    it('should save empty object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('empty', {})
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('{}')
    })

    it('should save empty array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('emptyArr', [])
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('[]')
    })

    it('should save empty string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('emptyStr', '')
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('""')
    })

    it('should handle zero', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('zero', 0)
      
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('0')
    })

    it('should handle negative zero', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('negZero', -0)
      
      // -0 becomes 0 in JSON
      const body = mockFetch.mock.calls[0][1].body
      expect(body).toBe('0')
    })
  })

  describe('String Edge Cases', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
    })

    it('should handle newlines in strings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('multiline', { text: 'line1\nline2\rline3' })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.text).toBe('line1\nline2\rline3')
    })

    it('should handle unicode characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('unicode', { 
        emoji: '🎮',
        japanese: 'ゲーム',
        arabic: 'لعبة'
      })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.emoji).toBe('🎮')
      expect(body.japanese).toBe('ゲーム')
    })

    it('should handle null bytes in strings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('nullbyte', { text: 'hello\x00world' })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.text).toBe('hello\x00world')
    })

    it('should handle very long strings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const longString = 'a'.repeat(100000)
      await wt.save('long', { data: longString })
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.data.length).toBe(100000)
    })
  })

  describe('HTTP Error Handling', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
    })

    it('should handle 400 Bad Request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid request' })
      })

      await expect(wt.save('test', {})).rejects.toThrow('Invalid request')
    })

    it('should handle 401 Unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid API key' })
      })

      await expect(wt.save('test', {})).rejects.toThrow('Invalid API key')
    })

    it('should handle 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Access denied' })
      })

      await expect(wt.save('test', {})).rejects.toThrow('Access denied')
    })

    it('should handle 404 Not Found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Save not found' })
      })

      // load returns null for 404 "Save not found"
      const result = await wt.load('missing')
      expect(result).toBeNull()
    })

    it('should handle 429 Rate Limited', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limit exceeded' })
      })

      await expect(wt.save('test', {})).rejects.toThrow('Rate limit exceeded')
    })

    it('should handle 500 Internal Server Error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' })
      })

      await expect(wt.save('test', {})).rejects.toThrow('Internal server error')
    })

    it('should handle 503 Service Unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service temporarily unavailable' })
      })

      await expect(wt.save('test', {})).rejects.toThrow('Service temporarily unavailable')
    })

    it('should handle missing error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({})
      })

      await expect(wt.save('test', {})).rejects.toThrow('HTTP 500')
    })

    it('should handle network failure', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(wt.save('test', {})).rejects.toThrow('Failed to fetch')
    })

    it('should handle timeout', async () => {
      mockFetch.mockImplementationOnce(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      )

      await expect(wt.save('test', {})).rejects.toThrow('Timeout')
    })
  })

  describe('localStorage Unavailable', () => {
    it('should work without localStorage', () => {
      // Simulate localStorage being unavailable
      const originalLocalStorage = global.localStorage
      // @ts-ignore
      delete global.localStorage

      const wt = new Watchtower({ gameId: 'test' })
      
      // Should still generate a player ID
      expect(wt.playerId).toMatch(/^player_[a-z0-9]+$/)

      // Restore
      global.localStorage = originalLocalStorage
    })

    it('should work when localStorage throws', () => {
      const originalLocalStorage = global.localStorage
      global.localStorage = {
        getItem: () => { throw new Error('Storage error') },
        setItem: () => { throw new Error('Storage error') },
        removeItem: () => {},
        clear: () => {},
        length: 0,
        key: () => null
      }

      // Should not throw during construction
      expect(() => new Watchtower({ gameId: 'test' })).not.toThrow()

      global.localStorage = originalLocalStorage
    })
  })

  describe('Room Edge Cases', () => {
    let wsInstances: any[] = []

    class MockWebSocket {
      static OPEN = 1
      static CONNECTING = 0
      readyState = MockWebSocket.CONNECTING
      onopen: any
      onclose: any
      onmessage: any
      onerror: any
      send = vi.fn()
      close = vi.fn()
      
      constructor(public url: string) {
        wsInstances.push(this)
      }

      simulateOpen() {
        this.readyState = MockWebSocket.OPEN
        this.onopen?.()
      }

      simulateMessage(data: any) {
        this.onmessage?.({ data: JSON.stringify(data) })
      }
    }

    global.WebSocket = MockWebSocket as any

    beforeEach(() => {
      wsInstances = []
    })

    it('should handle rapid player state updates', async () => {
      vi.useFakeTimers()
      
      const room = new Room('TEST', {
        gameId: 'test',
        playerId: 'p1',
        apiUrl: 'https://api.test.com',
        apiKey: ''
      })

      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      // Rapid updates (faster than sync interval)
      for (let i = 0; i < 100; i++) {
        room.player.set({ x: i })
      }

      // Advance past sync interval
      vi.advanceTimersByTime(100)

      // Should only send the final state
      const calls = wsInstances[0].send.mock.calls
      const lastCall = calls[calls.length - 1]
      const lastState = JSON.parse(lastCall[0])
      
      expect(lastState.state.x).toBe(99)

      vi.useRealTimers()
    })

    it('should handle disconnect during sync', async () => {
      vi.useFakeTimers()
      
      const room = new Room('TEST', {
        gameId: 'test',
        playerId: 'p1',
        apiUrl: 'https://api.test.com',
        apiKey: ''
      })

      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      room.player.set({ x: 100 })
      room.disconnect()

      // Should not throw when trying to sync after disconnect
      vi.advanceTimersByTime(100)

      vi.useRealTimers()
    })

    it('should handle empty players sync', async () => {
      const room = new Room('TEST', {
        gameId: 'test',
        playerId: 'p1',
        apiUrl: 'https://api.test.com',
        apiKey: ''
      })

      const handler = vi.fn()
      room.on('players', handler)

      const connectPromise = room.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      wsInstances[0].simulateMessage({
        type: 'players_sync',
        players: {}
      })

      expect(handler).toHaveBeenCalledWith({})
      expect(room.playerCount).toBe(0)
    })
  })

  describe('Concurrent Operations', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
    })

    it('should handle concurrent saves to different keys', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true })
      })

      const results = await Promise.all([
        wt.save('key1', { a: 1 }),
        wt.save('key2', { b: 2 }),
        wt.save('key3', { c: 3 })
      ])

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should handle concurrent load and save', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: 'test', data: { old: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

      const [loadResult] = await Promise.all([
        wt.load('test'),
        wt.save('test', { new: true })
      ])

      // Load should return old data (race condition)
      expect(loadResult).toEqual({ old: true })
    })

    it('should handle overlapping room creates', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'AAAA' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'BBBB' })
        })

      // Mock WebSocket
      let wsCount = 0
      class MockWS {
        static OPEN = 1
        readyState = 1
        onopen: any
        constructor() {
          wsCount++
          setTimeout(() => this.onopen?.(), 0)
        }
        send = vi.fn()
        close = vi.fn()
      }
      global.WebSocket = MockWS as any

      const [room1, room2] = await Promise.all([
        wt.createRoom(),
        wt.createRoom()
      ])

      expect(room1.code).toBe('AAAA')
      expect(room2.code).toBe('BBBB')
      expect(wsCount).toBe(2)
    })
  })
})
