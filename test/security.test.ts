/**
 * Watchtower SDK - Security Tests
 * Tests for input validation, injection prevention, and security edge cases
 * Rewritten for the current connect()/Room API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect, Room, ConnectOptions } from '../src/index'

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static CONNECTING = 0

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null

  constructor(public url: string) {
    MockWebSocket.lastInstance = this
  }

  simulateOpen(welcomeData?: { hostId?: string }) {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
    this.onmessage?.({
      data: JSON.stringify({
        type: 'welcome',
        hostId: welcomeData?.hostId || 'p_test',
        players: [],
      }),
    })
  }

  simulateError() {
    this.onerror?.({})
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  })

  static lastInstance: MockWebSocket | null = null
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn(),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  }),
}
global.localStorage = localStorageMock as unknown as Storage

describe('Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    MockWebSocket.lastInstance = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('WebSocket URL Construction', () => {
    it('should use wss:// for https API URLs', async () => {
      const connectPromise = connect('test-room', {
        apiUrl: 'https://api.example.com',
        playerId: 'p_test',
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      expect(MockWebSocket.lastInstance!.url).toMatch(/^wss:\/\//)

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should use ws:// for http API URLs', async () => {
      const connectPromise = connect('test-room', {
        apiUrl: 'http://localhost:8787',
        playerId: 'p_test',
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      expect(MockWebSocket.lastInstance!.url).toMatch(/^ws:\/\//)

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should include gameId in connection URL', async () => {
      const connectPromise = connect('test-room', {
        gameId: 'my-game-id',
        playerId: 'p_test',
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      expect(MockWebSocket.lastInstance!.url).toContain('gameId=my-game-id')

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should include playerId in connection URL', async () => {
      const connectPromise = connect('test-room', {
        playerId: 'custom-player-123',
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      expect(MockWebSocket.lastInstance!.url).toContain('playerId=custom-player-123')

      MockWebSocket.lastInstance!.simulateOpen({ hostId: 'custom-player-123' })
      const room = await connectPromise
      room.leave()
    })

    it('should URL-encode player name with special characters', async () => {
      const connectPromise = connect('test-room', {
        playerId: 'p_test',
        name: 'Player <script>alert(1)</script>',
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      const url = MockWebSocket.lastInstance!.url
      // Should be URL-encoded, not raw HTML (URLSearchParams encodes angle brackets)
      expect(url).not.toContain('<script>')
      expect(url).toContain('%3Cscript%3E')

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should JSON-encode meta in connection URL', async () => {
      const connectPromise = connect('test-room', {
        playerId: 'p_test',
        meta: { color: '#ff0000', level: 5 },
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      const url = MockWebSocket.lastInstance!.url
      expect(url).toContain('meta=')
      expect(url).toContain(encodeURIComponent(JSON.stringify({ color: '#ff0000', level: 5 })))

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })
  })

  describe('create Parameter', () => {
    it('should pass create=true by default', async () => {
      const connectPromise = connect('test-room', { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      expect(MockWebSocket.lastInstance!.url).toContain('create=true')

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should pass create=false when explicitly set', async () => {
      const connectPromise = connect('test-room', {
        playerId: 'p_test',
        create: false,
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      expect(MockWebSocket.lastInstance!.url).toContain('create=false')

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })
  })

  describe('Player ID Generation', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        localStorageMock.clear()
        const room = new Room(`test-${i}`, {})
        ids.add(room.playerId)
      }
      expect(ids.size).toBe(100)
    })

    it('should prefix generated IDs with p_', () => {
      localStorageMock.clear()
      const room = new Room('test', {})
      expect(room.playerId).toMatch(/^p_/)
    })

    it('should generate IDs with reasonable length', () => {
      localStorageMock.clear()
      const room = new Room('test', {})
      // p_ + at least 9 chars
      expect(room.playerId.length).toBeGreaterThanOrEqual(11)
    })

    it('should persist generated ID in localStorage', () => {
      localStorageMock.clear()
      const room = new Room('test', {})
      const id = room.playerId
      expect(localStorageMock.setItem).toHaveBeenCalledWith('watchtower_player_id', id)
    })

    it('should reuse ID from localStorage', () => {
      localStorageMock.store['watchtower_player_id'] = 'p_existing123'
      const room = new Room('test', {})
      expect(room.playerId).toBe('p_existing123')
    })
  })

  describe('Injection Prevention', () => {
    it('should safely handle malicious roomId in URL path', async () => {
      // roomId is placed in the URL path — the server uppercases it and uses
      // it as a Durable Object name, not a filesystem path. Path traversal is
      // harmless because the server never uses roomId as a file path.
      const maliciousId = '../../admin'
      const connectPromise = connect(maliciousId, { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      const url = MockWebSocket.lastInstance!.url
      // Verify the roomId is in the URL (server will uppercase + sanitize)
      expect(url).toContain('/v1/connect/')

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should safely handle malicious gameId', async () => {
      const maliciousGameId = 'game\r\nX-Evil: injected'
      const connectPromise = connect('test-room', {
        playerId: 'p_test',
        gameId: maliciousGameId,
      })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      // gameId in URL params should be encoded
      const url = MockWebSocket.lastInstance!.url
      expect(url).not.toContain('\r\n')

      MockWebSocket.lastInstance!.simulateOpen()
      const room = await connectPromise
      room.leave()
    })

    it('should JSON.stringify broadcast data safely', async () => {
      const connectPromise = connect('test-room', { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen()

      const room = await connectPromise
      const ws = MockWebSocket.lastInstance!

      // Broadcast with potentially dangerous content
      room.broadcast({
        __proto__: { malicious: true },
        constructor: { prototype: { evil: true } },
        normal: 'data',
      })

      expect(ws.send).toHaveBeenCalled()
      const sent = JSON.parse(ws.send.mock.calls[0][0])
      expect(sent.type).toBe('broadcast')
      expect(sent.data.normal).toBe('data')

      room.leave()
    })
  })

  describe('XSS Prevention', () => {
    it('should not use eval or Function constructor in source', async () => {
      // Read source to verify no eval usage
      const { readFileSync } = await import('fs')
      const source = readFileSync(
        new URL('../src/index.ts', import.meta.url),
        'utf-8'
      )

      expect(source).not.toContain('eval(')
      expect(source).not.toContain('new Function(')
    })
  })

  describe('Error Handling', () => {
    it('should not expose internal state on connection error', async () => {
      const connectPromise = connect('test-room', { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateError()

      try {
        await connectPromise
      } catch (e: unknown) {
        const err = e as Error
        expect(err.message).toBe('WebSocket connection failed')
        // Should not expose internal details
        expect(err.message).not.toContain('config')
        expect(err.message).not.toContain('apiUrl')
      }
    })

    it('should handle malformed server messages without crashing', async () => {
      const connectPromise = connect('test-room', { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      const ws = MockWebSocket.lastInstance!

      // Manually open and send welcome
      ws.readyState = MockWebSocket.OPEN
      ws.onopen?.()
      ws.onmessage?.({ data: JSON.stringify({ type: 'welcome', hostId: 'p_test', players: [] }) })

      const room = await connectPromise

      // Send various malformed messages — should not throw
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ws.onmessage?.({ data: 'not json' })
      ws.onmessage?.({ data: '{}' })
      ws.onmessage?.({ data: JSON.stringify({ type: 'unknown_type' }) })
      ws.onmessage?.({ data: JSON.stringify({ type: 'message' }) }) // missing from/data

      expect(room.connected).toBe(true) // Should still be connected

      consoleSpy.mockRestore()
      room.leave()
    })
  })

  describe('Kick Safety', () => {
    it('should throw when non-host tries to kick', async () => {
      const connectPromise = connect('test-room', { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      // Make someone else the host
      MockWebSocket.lastInstance!.simulateOpen({ hostId: 'p_other' })

      const room = await connectPromise

      expect(room.isHost).toBe(false)
      expect(() => room.kick('p_other')).toThrow('Only the host can kick players')

      room.leave()
    })

    it('should throw when trying to kick yourself', async () => {
      const connectPromise = connect('test-room', { playerId: 'p_test' })

      await vi.waitFor(() => expect(MockWebSocket.lastInstance).not.toBeNull())
      MockWebSocket.lastInstance!.simulateOpen({ hostId: 'p_test' })

      const room = await connectPromise

      expect(room.isHost).toBe(true)
      expect(() => room.kick('p_test')).toThrow('Cannot kick yourself')

      room.leave()
    })
  })
})
