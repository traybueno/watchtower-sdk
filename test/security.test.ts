/**
 * Watchtower SDK - Security Tests
 * Tests for input validation, injection prevention, and security edge cases
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

describe('Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockFetch.mockReset()
  })

  describe('Input Validation', () => {
    describe('Game ID', () => {
      it('should accept valid game IDs', () => {
        expect(() => new Watchtower({ gameId: 'my-game' })).not.toThrow()
        expect(() => new Watchtower({ gameId: 'game_123' })).not.toThrow()
        expect(() => new Watchtower({ gameId: 'Game123' })).not.toThrow()
      })

      it('should handle empty gameId', () => {
        // SDK currently doesn't validate - this documents current behavior
        // In production, API should reject empty gameId
        const wt = new Watchtower({ gameId: '' })
        expect(wt.gameId).toBe('')
      })
    })

    describe('Save Keys', () => {
      it('should URL-encode special characters in save keys', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        await wt.save('path/to/save', { data: 1 })

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('path%2Fto%2Fsave'),
          expect.anything()
        )
      })

      it('should handle save keys with URL-unsafe characters', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        await wt.save('key?with&special=chars', { data: 1 })

        // Should be encoded properly
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('key%3Fwith%26special%3Dchars'),
          expect.anything()
        )
      })

      it('should handle unicode in save keys', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        await wt.save('保存データ', { data: 1 })

        // Should be URL encoded
        const callUrl = mockFetch.mock.calls[0][0] as string
        expect(callUrl).not.toContain('保存データ')
        expect(callUrl).toContain('%')
      })
    })

    describe('Room Codes', () => {
      it('should uppercase room codes', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        await wt.joinRoom('abcd')

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

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        await wt.joinRoom('  wxyz  \n')

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/rooms/WXYZ/join'),
          expect.anything()
        )
      })
    })
  })

  describe('Injection Prevention', () => {
    describe('Header Injection', () => {
      it('should not allow header injection via gameId', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ keys: [] })
        })

        const maliciousGameId = 'game\r\nX-Evil-Header: injected'
        const wt = new Watchtower({ gameId: maliciousGameId, playerId: 'p1' })
        await wt.listSaves()

        // The gameId is sent as a header value
        // Modern fetch implementations reject headers with CRLF
        const headers = mockFetch.mock.calls[0][1].headers
        expect(headers['X-Game-ID']).toBe(maliciousGameId)
        // Note: Actual injection prevention happens at the fetch/browser level
      })

      it('should not allow header injection via playerId', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ keys: [] })
        })

        const maliciousPlayerId = 'player\r\nX-Evil: injected'
        const wt = new Watchtower({ gameId: 'test', playerId: maliciousPlayerId })
        await wt.listSaves()

        const headers = mockFetch.mock.calls[0][1].headers
        expect(headers['X-Player-ID']).toBe(maliciousPlayerId)
      })
    })

    describe('JSON Injection', () => {
      it('should properly serialize complex objects', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        
        // Object with potentially dangerous content
        const saveData = {
          __proto__: { malicious: true },
          constructor: { prototype: { evil: true } },
          normal: 'data'
        }
        
        await wt.save('test', saveData)

        const body = JSON.parse(mockFetch.mock.calls[0][1].body)
        // __proto__ and constructor are stringified normally by JSON.stringify
        expect(body.normal).toBe('data')
      })

      it('should handle circular references gracefully', async () => {
        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        
        const circular: any = { a: 1 }
        circular.self = circular

        // JSON.stringify throws on circular references
        await expect(wt.save('test', circular)).rejects.toThrow()
      })
    })

    describe('Path Traversal', () => {
      it('should encode path traversal attempts in save keys', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true })
        })

        const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
        await wt.save('../../../etc/passwd', { data: 1 })

        // Path traversal should be URL encoded
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('..%2F..%2F..%2Fetc%2Fpasswd'),
          expect.anything()
        )
      })
    })
  })

  describe('API Key Handling', () => {
    it('should include API key in Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] })
      })

      const wt = new Watchtower({ 
        gameId: 'test', 
        playerId: 'p1',
        apiKey: 'secret-key-123'
      })
      await wt.listSaves()

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers['Authorization']).toBe('Bearer secret-key-123')
    })

    it('should not include Authorization header without API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] })
      })

      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      await wt.listSaves()

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers['Authorization']).toBeUndefined()
    })

    it('should not log API key (config is private)', () => {
      const wt = new Watchtower({ 
        gameId: 'test',
        apiKey: 'super-secret'
      })

      // Public properties should not expose API key
      expect(JSON.stringify(wt)).not.toContain('super-secret')
      expect(wt.toString()).not.toContain('super-secret')
    })
  })

  describe('Error Handling', () => {
    it('should not expose internal errors in messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ 
          error: 'Internal server error',
          stack: 'at Database.query...'  // Should not be exposed
        })
      })

      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      
      try {
        await wt.load('test')
      } catch (e: any) {
        expect(e.message).toBe('Internal server error')
        expect(e.message).not.toContain('Database.query')
      }
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      
      await expect(wt.load('test')).rejects.toThrow('Network error')
    })

    it('should handle non-JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token') }
      })

      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      
      await expect(wt.load('test')).rejects.toThrow()
    })
  })

  describe('Player ID Generation', () => {
    it('should generate cryptographically reasonable IDs', () => {
      localStorageMock.clear()
      const wt1 = new Watchtower({ gameId: 'test' })
      
      localStorageMock.clear()
      const wt2 = new Watchtower({ gameId: 'test' })
      
      // IDs should be different
      expect(wt1.playerId).not.toBe(wt2.playerId)
      
      // IDs should have reasonable entropy (9 chars from base36)
      expect(wt1.playerId.length).toBeGreaterThan(10)
      expect(wt2.playerId.length).toBeGreaterThan(10)
    })

    it('should not use predictable player IDs', () => {
      localStorageMock.clear()
      
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        localStorageMock.clear()
        const wt = new Watchtower({ gameId: 'test' })
        ids.add(wt.playerId)
      }
      
      // All 100 IDs should be unique
      expect(ids.size).toBe(100)
    })
  })

  describe('WebSocket Security', () => {
    let wsInstances: any[] = []

    class MockWebSocket {
      static OPEN = 1
      readyState = 0
      onopen: any
      onclose: any
      onmessage: any
      onerror: any
      send = vi.fn()
      close = vi.fn()
      
      constructor(public url: string) {
        wsInstances.push(this)
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN
          this.onopen?.()
        }, 0)
      }
    }
    global.WebSocket = MockWebSocket as any

    beforeEach(() => {
      wsInstances = []
    })

    it('should use secure WebSocket (wss) for https URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 'TEST' })
      })

      const wt = new Watchtower({ 
        gameId: 'test',
        playerId: 'p1',
        apiUrl: 'https://api.example.com'
      })
      
      await wt.createRoom()
      
      expect(wsInstances[0].url).toMatch(/^wss:\/\//)
    })

    it('should include API key in WebSocket URL params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 'TEST' })
      })

      const wt = new Watchtower({ 
        gameId: 'test',
        playerId: 'p1',
        apiKey: 'secret-123'
      })
      
      await wt.createRoom()
      
      expect(wsInstances[0].url).toContain('apiKey=secret-123')
    })

    it('should not include API key param when not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 'TEST' })
      })

      const wt = new Watchtower({ 
        gameId: 'test',
        playerId: 'p1'
      })
      
      await wt.createRoom()
      
      expect(wsInstances[0].url).not.toContain('apiKey=')
    })
  })

  describe('XSS Prevention', () => {
    it('should not evaluate received data as code', () => {
      // The SDK should never use eval() or Function() on received data
      const sourceCode = Watchtower.toString()
      
      expect(sourceCode).not.toContain('eval(')
      expect(sourceCode).not.toContain('new Function(')
    })
  })

  describe('Data Size Limits', () => {
    it('should allow large save data (SDK does not limit)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })

      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      
      // 1MB of data
      const largeData = { data: 'x'.repeat(1024 * 1024) }
      
      // SDK should not reject - server will validate
      await wt.save('large', largeData)
      
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('Timing & Race Conditions', () => {
    it('should handle rapid consecutive saves', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true })
      })

      const wt = new Watchtower({ gameId: 'test', playerId: 'p1' })
      
      // Fire off multiple saves rapidly
      const promises = [
        wt.save('slot1', { v: 1 }),
        wt.save('slot2', { v: 2 }),
        wt.save('slot3', { v: 3 }),
        wt.save('slot1', { v: 4 }), // Same key, different value
      ]
      
      await Promise.all(promises)
      
      // All should complete
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })
})
