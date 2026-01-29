/**
 * Watchtower SDK - Core Unit Tests
 * Tests for the main Watchtower class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Watchtower, Room } from '../src/index'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  
  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => this.onopen?.(), 0)
  }
  
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  })
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

describe('Watchtower', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Constructor & Configuration', () => {
    it('should create instance with required config', () => {
      const wt = new Watchtower({ gameId: 'test-game' })
      
      expect(wt.gameId).toBe('test-game')
      expect(wt.playerId).toBeDefined()
      expect(wt.playerId).toMatch(/^player_[a-z0-9]+$/)
    })

    it('should use provided playerId', () => {
      const wt = new Watchtower({ 
        gameId: 'test-game',
        playerId: 'custom-player-123'
      })
      
      expect(wt.playerId).toBe('custom-player-123')
    })

    it('should use custom apiUrl', () => {
      const wt = new Watchtower({ 
        gameId: 'test-game',
        apiUrl: 'https://custom-api.example.com'
      })
      
      // Access private config via any cast for testing
      expect((wt as any).config.apiUrl).toBe('https://custom-api.example.com')
    })

    it('should store playerId in localStorage for persistence', () => {
      new Watchtower({ gameId: 'test-game' })
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'watchtower_player_id',
        expect.stringMatching(/^player_[a-z0-9]+$/)
      )
    })

    it('should reuse playerId from localStorage', () => {
      localStorageMock.store['watchtower_player_id'] = 'existing-player-id'
      
      const wt = new Watchtower({ gameId: 'test-game' })
      
      expect(wt.playerId).toBe('existing-player-id')
    })

    it('should generate unique playerIds', () => {
      localStorageMock.clear()
      const wt1 = new Watchtower({ gameId: 'game1' })
      
      localStorageMock.clear()
      const wt2 = new Watchtower({ gameId: 'game2' })
      
      // Different instances should get different IDs (when localStorage is cleared)
      expect(wt1.playerId).not.toBe(wt2.playerId)
    })
  })

  describe('Saves API', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ 
        gameId: 'test-game',
        playerId: 'test-player',
        apiKey: 'test-api-key'
      })
    })

    it('should save data with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('progress', { level: 5, coins: 100 })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://watchtower-api.watchtower-host.workers.dev/v1/saves/progress',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Player-ID': 'test-player',
            'X-Game-ID': 'test-game',
            'Authorization': 'Bearer test-api-key'
          }),
          body: JSON.stringify({ level: 5, coins: 100 })
        })
      )
    })

    it('should load data correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key: 'progress', data: { level: 10 } })
      })

      const result = await wt.load('progress')

      expect(result).toEqual({ level: 10 })
    })

    it('should return null for non-existent saves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Save not found' })
      })

      const result = await wt.load('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw on other API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' })
      })

      await expect(wt.load('progress')).rejects.toThrow('Server error')
    })

    it('should list all saves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: ['slot1', 'slot2', 'settings'] })
      })

      const keys = await wt.listSaves()

      expect(keys).toEqual(['slot1', 'slot2', 'settings'])
    })

    it('should delete saves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.deleteSave('old-save')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/saves/old-save'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should URL-encode save keys', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.save('path/with/slashes', { data: 1 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/saves/path%2Fwith%2Fslashes'),
        expect.anything()
      )
    })
  })

  describe('Rooms API', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ 
        gameId: 'test-game',
        playerId: 'test-player'
      })
    })

    it('should create room and connect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 'ABCD' })
      })

      const room = await wt.createRoom()

      expect(room.code).toBe('ABCD')
      expect(room.playerId).toBe('test-player')
    })

    it('should join room with uppercase code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const room = await wt.joinRoom('abcd')

      expect(room.code).toBe('ABCD')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/rooms/ABCD/join'),
        expect.anything()
      )
    })

    it('should trim whitespace from room codes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const room = await wt.joinRoom('  wxyz  ')

      expect(room.code).toBe('WXYZ')
    })

    it('should get room info without joining', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'TEST',
          gameId: 'test-game',
          hostId: 'host-player',
          players: [{ id: 'host-player', joinedAt: Date.now() }],
          playerCount: 1
        })
      })

      const info = await wt.getRoomInfo('test')

      expect(info.code).toBe('TEST')
      expect(info.hostId).toBe('host-player')
      expect(info.playerCount).toBe(1)
    })
  })

  describe('Stats API', () => {
    let wt: Watchtower

    beforeEach(() => {
      wt = new Watchtower({ gameId: 'test-game', playerId: 'test-player' })
    })

    it('should get game stats', async () => {
      const mockStats = {
        online: 42,
        today: 100,
        monthly: 1000,
        total: 5000,
        rooms: 10,
        inRooms: 30,
        avgSession: 300,
        avgRoomSize: 3,
        updatedAt: Date.now()
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStats
      })

      const stats = await wt.getStats()

      expect(stats).toEqual(mockStats)
    })

    it('should get player stats', async () => {
      const mockPlayerStats = {
        firstSeen: '2026-01-01T00:00:00Z',
        lastSeen: '2026-01-29T12:00:00Z',
        sessions: 50,
        playtime: 36000
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlayerStats
      })

      const stats = await wt.getPlayerStats()

      expect(stats.sessions).toBe(50)
      expect(stats.playtime).toBe(36000)
    })

    it('should track session start', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.trackSessionStart()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/stats/track'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ event: 'session_start' })
        })
      )
    })

    it('should track session end', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      await wt.trackSessionEnd()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/stats/track'),
        expect.objectContaining({
          body: JSON.stringify({ event: 'session_end' })
        })
      )
    })

    it('should provide stats as a promise getter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ online: 10 })
      })

      const stats = await wt.stats

      expect(stats.online).toBe(10)
    })
  })
})
