/**
 * Watchtower SDK - Integration Tests
 *
 * These tests run against the LIVE API. Only run manually:
 *   WATCHTOWER_GAME_ID=your-game-id npm run test:integration
 *
 * Requires:
 *   - WATCHTOWER_GAME_ID env var (your project's game ID)
 *   - A running Watchtower API instance
 */

import { describe, it, expect, afterEach } from 'vitest'
import { connect, Room } from '../src/index'

const API_URL = process.env.WATCHTOWER_API_URL || 'https://watchtower-api.watchtower-host.workers.dev'
const GAME_ID = process.env.WATCHTOWER_GAME_ID

// Skip in CI / automated runs
const SKIP_INTEGRATION = !GAME_ID

describe.skipIf(SKIP_INTEGRATION)('Integration Tests (Live API)', () => {
  const rooms: Room[] = []

  afterEach(() => {
    for (const room of rooms) {
      try { room.leave() } catch {}
    }
    rooms.length = 0
  })

  describe('Room Connection', () => {
    it('should connect to a new room', async () => {
      const room = await connect(undefined, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `test-${Date.now()}`,
      })
      rooms.push(room)

      expect(room.connected).toBe(true)
      expect(room.code).toMatch(/^[A-Z0-9]{6}$/)
      expect(room.isHost).toBe(true)
      expect(room.playerCount).toBe(1)
    })

    it('should connect to an explicit room ID', async () => {
      const roomId = `INT-TEST-${Date.now()}`
      const room = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `test-${Date.now()}`,
      })
      rooms.push(room)

      expect(room.connected).toBe(true)
      expect(room.code).toBe(roomId)
    })

    it('should connect with player name and meta', async () => {
      const room = await connect(undefined, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `test-${Date.now()}`,
        name: 'IntegrationPlayer',
        meta: { avatar: 'knight', color: '#ff0000' },
      })
      rooms.push(room)

      expect(room.connected).toBe(true)
      const self = room.players.find(p => p.id === room.playerId)
      expect(self?.name).toBe('IntegrationPlayer')
    })
  })

  describe('Multi-Player', () => {
    it('should allow two players to join the same room', async () => {
      const roomId = `MP-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p1-${Date.now()}`,
        name: 'Player1',
      })
      rooms.push(room1)

      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p2-${Date.now()}`,
        name: 'Player2',
      })
      rooms.push(room2)

      // Player 2 should see both players
      expect(room2.playerCount).toBe(2)
      // Player 1 is host (connected first)
      expect(room1.isHost).toBe(true)
      expect(room2.isHost).toBe(false)
    })

    it('should deliver broadcast messages', async () => {
      const roomId = `BC-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p1-${Date.now()}`,
      })
      rooms.push(room1)

      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p2-${Date.now()}`,
      })
      rooms.push(room2)

      // Wait for connection to stabilize
      await new Promise(r => setTimeout(r, 200))

      const received: unknown[] = []
      room2.on('message', (_from, data) => {
        received.push(data)
      })

      room1.broadcast({ type: 'test', value: 42 })

      await new Promise(r => setTimeout(r, 500))

      expect(received.length).toBe(1)
      expect(received[0]).toEqual({ type: 'test', value: 42 })
    })

    it('should deliver direct messages', async () => {
      const roomId = `DM-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p1-${Date.now()}`,
      })
      rooms.push(room1)

      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p2-${Date.now()}`,
      })
      rooms.push(room2)

      await new Promise(r => setTimeout(r, 200))

      const received: unknown[] = []
      room2.on('message', (_from, data) => {
        received.push(data)
      })

      room1.send(room2.playerId, { secret: 'hello' })

      await new Promise(r => setTimeout(r, 500))

      expect(received.length).toBe(1)
      expect(received[0]).toEqual({ secret: 'hello' })
    })
  })

  describe('Host Assignment', () => {
    it('should transfer host when first player leaves', async () => {
      const roomId = `HOST-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p1-${Date.now()}`,
      })
      rooms.push(room1)

      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p2-${Date.now()}`,
      })
      rooms.push(room2)

      await new Promise(r => setTimeout(r, 200))

      expect(room1.isHost).toBe(true)

      // Player 1 leaves
      room1.leave()
      rooms.splice(rooms.indexOf(room1), 1)

      // Wait for host transfer
      await new Promise(r => setTimeout(r, 500))

      expect(room2.isHost).toBe(true)
    })
  })

  describe('Kick', () => {
    it('should allow host to kick a player', async () => {
      const roomId = `KICK-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p1-${Date.now()}`,
      })
      rooms.push(room1)

      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p2-${Date.now()}`,
      })
      rooms.push(room2)

      await new Promise(r => setTimeout(r, 200))

      let kickedReason: string | undefined
      room2.on('kicked', (reason) => {
        kickedReason = reason
      })

      room1.kick(room2.playerId, 'Test kick')

      await new Promise(r => setTimeout(r, 500))

      expect(kickedReason).toBe('Test kick')
    })
  })

  describe('Reconnection', () => {
    it('should allow reconnecting with same playerId', async () => {
      const roomId = `RECONN-${Date.now()}`
      const playerId = `p-reconn-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId,
      })
      rooms.push(room1)
      room1.leave()
      rooms.splice(rooms.indexOf(room1), 1)

      await new Promise(r => setTimeout(r, 300))

      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId,
      })
      rooms.push(room2)

      expect(room2.connected).toBe(true)
      expect(room2.playerId).toBe(playerId)
    })
  })

  describe('Event History', () => {
    it('should provide recent events to late joiners', async () => {
      const roomId = `HIST-${Date.now()}`

      const room1 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p1-${Date.now()}`,
      })
      rooms.push(room1)

      // Send some messages
      room1.broadcast({ msg: 'first' })
      room1.broadcast({ msg: 'second' })

      await new Promise(r => setTimeout(r, 300))

      // Late joiner
      const room2 = await connect(roomId, {
        gameId: GAME_ID!,
        apiUrl: API_URL,
        playerId: `p2-${Date.now()}`,
      })
      rooms.push(room2)

      // Should have recent events from the welcome message
      expect(room2.history.length).toBeGreaterThan(0)
    })
  })
})
