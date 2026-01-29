/**
 * Watchtower SDK - Integration Tests
 * 
 * These tests run against the LIVE API. Only run manually:
 *   npm run test:integration
 * 
 * Requires:
 *   - WATCHTOWER_API_KEY env var
 *   - WATCHTOWER_GAME_ID env var (optional, defaults to 'sdk-test')
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Skip these tests in CI/automated runs
const SKIP_INTEGRATION = !process.env.WATCHTOWER_API_KEY

// Dynamic import to avoid loading SDK during unit tests
const loadSDK = async () => {
  if (SKIP_INTEGRATION) return null
  const { Watchtower } = await import('../src/index')
  return Watchtower
}

describe.skipIf(SKIP_INTEGRATION)('Integration Tests (Live API)', () => {
  let Watchtower: any
  let wt: any
  const testKey = `test-${Date.now()}`

  beforeAll(async () => {
    Watchtower = await loadSDK()
    if (!Watchtower) return

    wt = new Watchtower({
      gameId: process.env.WATCHTOWER_GAME_ID || 'sdk-test',
      apiKey: process.env.WATCHTOWER_API_KEY
    })
  })

  afterAll(async () => {
    if (!wt) return
    // Cleanup test data
    try {
      await wt.deleteSave(testKey)
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Saves API', () => {
    it('should save and load data', async () => {
      const testData = { 
        level: 5, 
        coins: 100,
        timestamp: Date.now()
      }

      await wt.save(testKey, testData)
      const loaded = await wt.load(testKey)

      expect(loaded).toEqual(testData)
    })

    it('should return null for missing saves', async () => {
      const result = await wt.load('nonexistent-key-12345')
      expect(result).toBeNull()
    })

    it('should list saves', async () => {
      const keys = await wt.listSaves()
      expect(Array.isArray(keys)).toBe(true)
      expect(keys).toContain(testKey)
    })

    it('should delete saves', async () => {
      const deleteKey = `delete-test-${Date.now()}`
      await wt.save(deleteKey, { temp: true })
      await wt.deleteSave(deleteKey)
      
      const result = await wt.load(deleteKey)
      expect(result).toBeNull()
    })

    it('should handle large saves', async () => {
      const largeData = {
        items: Array(1000).fill(null).map((_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: 'x'.repeat(100)
        }))
      }

      const largeKey = `large-${Date.now()}`
      await wt.save(largeKey, largeData)
      const loaded = await wt.load(largeKey)
      
      expect(loaded.items.length).toBe(1000)
      
      // Cleanup
      await wt.deleteSave(largeKey)
    })
  })

  describe('Stats API', () => {
    it('should get game stats', async () => {
      const stats = await wt.getStats()
      
      expect(stats).toHaveProperty('online')
      expect(stats).toHaveProperty('today')
      expect(stats).toHaveProperty('monthly')
      expect(stats).toHaveProperty('total')
      expect(stats).toHaveProperty('rooms')
    })

    it('should get player stats', async () => {
      const playerStats = await wt.getPlayerStats()
      
      expect(playerStats).toHaveProperty('sessions')
      expect(playerStats).toHaveProperty('playtime')
    })

    it('should track session events', async () => {
      // These shouldn't throw
      await wt.trackSessionStart()
      await wt.trackSessionEnd()
    })
  })

  describe('Rooms API', () => {
    it('should create a room', async () => {
      const room = await wt.createRoom()
      
      expect(room.code).toMatch(/^[A-Z]{4}$/)
      expect(room.connected).toBe(true)
      
      room.disconnect()
    })

    it('should join a room', async () => {
      // Create room first
      const room1 = await wt.createRoom()
      
      // Create second client and join
      const wt2 = new Watchtower({
        gameId: process.env.WATCHTOWER_GAME_ID || 'sdk-test',
        apiKey: process.env.WATCHTOWER_API_KEY,
        playerId: 'player-2'
      })
      
      const room2 = await wt2.joinRoom(room1.code)
      
      expect(room2.code).toBe(room1.code)
      expect(room2.connected).toBe(true)
      
      room1.disconnect()
      room2.disconnect()
    })

    it('should get room info without joining', async () => {
      const room = await wt.createRoom()
      const info = await wt.getRoomInfo(room.code)
      
      expect(info.code).toBe(room.code)
      expect(info.playerCount).toBe(1)
      
      room.disconnect()
    })

    it('should broadcast messages', async () => {
      const room1 = await wt.createRoom()
      
      const wt2 = new Watchtower({
        gameId: process.env.WATCHTOWER_GAME_ID || 'sdk-test',
        apiKey: process.env.WATCHTOWER_API_KEY,
        playerId: 'player-2'
      })
      const room2 = await wt2.joinRoom(room1.code)

      // Wait for connection to stabilize
      await new Promise(r => setTimeout(r, 100))

      const received: any[] = []
      room2.on('message', (from: string, data: any) => {
        received.push({ from, data })
      })

      room1.broadcast({ type: 'test', value: 42 })

      // Wait for message
      await new Promise(r => setTimeout(r, 200))

      expect(received.length).toBe(1)
      expect(received[0].data).toEqual({ type: 'test', value: 42 })

      room1.disconnect()
      room2.disconnect()
    })

    it('should sync player state', async () => {
      const room1 = await wt.createRoom()
      
      const wt2 = new Watchtower({
        gameId: process.env.WATCHTOWER_GAME_ID || 'sdk-test',
        apiKey: process.env.WATCHTOWER_API_KEY,
        playerId: 'player-2'
      })
      const room2 = await wt2.joinRoom(room1.code)

      // Wait for connection
      await new Promise(r => setTimeout(r, 100))

      let lastPlayers: any = {}
      room2.on('players', (players: any) => {
        lastPlayers = players
      })

      room1.player.set({ x: 100, y: 200 })
      room1.player.sync()

      // Wait for sync
      await new Promise(r => setTimeout(r, 200))

      expect(lastPlayers[wt.playerId]).toBeDefined()
      expect(lastPlayers[wt.playerId].x).toBe(100)

      room1.disconnect()
      room2.disconnect()
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid API key', async () => {
      const badWt = new Watchtower({
        gameId: 'test',
        apiKey: 'invalid-key'
      })

      await expect(badWt.listSaves()).rejects.toThrow()
    })

    it('should handle invalid room codes', async () => {
      await expect(wt.joinRoom('XXXX')).rejects.toThrow()
    })
  })
})
