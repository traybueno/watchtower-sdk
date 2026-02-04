/**
 * Documentation Sync Tests
 * 
 * Verifies that SDK capabilities match what's documented.
 * Run these when updating docs or SDK to ensure consistency.
 */

import { describe, it, expect } from 'vitest'
import { Watchtower } from '../src/index'

describe('Documentation Claims', () => {
  describe('SDK exports', () => {
    it('exports Watchtower class', () => {
      expect(Watchtower).toBeDefined()
      expect(typeof Watchtower).toBe('function')
    })

    it('Watchtower has documented methods', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      
      // Cloud saves (documented in README)
      expect(typeof wt.save).toBe('function')
      expect(typeof wt.load).toBe('function')
      expect(typeof wt.listSaves).toBe('function')
      expect(typeof wt.deleteSave).toBe('function')
      
      // Sync (documented in README)
      expect(typeof wt.sync).toBe('function')
    })
  })

  describe('Sync options', () => {
    it('accepts all documented options', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      const state = { players: {} }
      
      // All options from docs should be accepted without error
      const sync = wt.sync(state, {
        tickRate: 20,
        interpolate: true,
        interpolationDelay: 100,
        jitterBuffer: 50,
        autoReconnect: true,
        maxReconnectAttempts: 10
      })
      
      expect(sync).toBeDefined()
    })

    it('has documented defaults', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      const state = { players: {} }
      const sync = wt.sync(state)
      
      // Check internal options via the state reference
      expect(sync.state).toBe(state)
      expect(sync.myId).toBeDefined()
      expect(typeof sync.myId).toBe('string')
    })
  })

  describe('Sync properties', () => {
    it('has all documented properties', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      const state = { players: {} }
      const sync = wt.sync(state)
      
      // From docs: sync.myId, sync.roomId, sync.connected, sync.playerCount, sync.latency
      expect('myId' in sync).toBe(true)
      expect('roomId' in sync).toBe(true)
      expect('connected' in sync).toBe(true)
      expect('playerCount' in sync).toBe(true)
      expect('latency' in sync).toBe(true)
      
      // Check types
      expect(typeof sync.myId).toBe('string')
      expect(sync.roomId).toBeNull() // Not connected yet
      expect(typeof sync.connected).toBe('boolean')
      expect(typeof sync.playerCount).toBe('number')
      expect(typeof sync.latency).toBe('number')
    })
  })

  describe('Sync methods', () => {
    it('has all documented methods', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      const state = { players: {} }
      const sync = wt.sync(state)
      
      // From docs
      expect(typeof sync.join).toBe('function')
      expect(typeof sync.leave).toBe('function')
      expect(typeof sync.create).toBe('function')
      expect(typeof sync.listRooms).toBe('function')
      expect(typeof sync.broadcast).toBe('function')
      expect(typeof sync.on).toBe('function')
      expect(typeof sync.off).toBe('function')
    })
  })

  describe('Sync events', () => {
    it('supports all documented events', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      const state = { players: {} }
      const sync = wt.sync(state)
      
      // All documented events should be registerable without error
      const events = [
        'join',
        'leave', 
        'connected',
        'disconnected',
        'reconnecting',
        'reconnected',
        'error',
        'message'
      ]
      
      for (const event of events) {
        // Should not throw
        const handler = () => {}
        sync.on(event as any, handler)
        sync.off(event, handler)
      }
    })
  })

  describe('State templates', () => {
    it('works with movement game state', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      
      interface MovementState {
        players: Record<string, {
          x: number
          y: number
          name: string
          color: string
        }>
      }
      
      const state: MovementState = { players: {} }
      const sync = wt.sync(state, {
        interpolate: true,
        interpolationDelay: 100,
        jitterBuffer: 50
      })
      
      // Should work without error
      state.players[sync.myId] = { x: 0, y: 0, name: 'Test', color: '#fff' }
      expect(state.players[sync.myId]).toBeDefined()
    })

    it('works with chat/lobby state', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      
      interface LobbyState {
        players: Record<string, {
          name: string
          avatar: string
          ready: boolean
        }>
        messages: Array<{
          from: string
          text: string
          ts: number
        }>
      }
      
      const state: LobbyState = { players: {}, messages: [] }
      const sync = wt.sync(state, { interpolate: false })
      
      state.players[sync.myId] = { name: 'Test', avatar: 'default', ready: false }
      state.messages.push({ from: sync.myId, text: 'Hello', ts: Date.now() })
      
      expect(state.players[sync.myId]).toBeDefined()
      expect(state.messages.length).toBe(1)
    })

    it('works with turn-based state', () => {
      const wt = new Watchtower({ gameId: 'test', apiKey: 'test' })
      
      interface TurnBasedState {
        players: Record<string, {
          name: string
          score: number
        }>
        currentTurn: string
        phase: 'waiting' | 'playing' | 'finished'
      }
      
      const state: TurnBasedState = { 
        players: {}, 
        currentTurn: '', 
        phase: 'waiting' 
      }
      const sync = wt.sync(state, { interpolate: false })
      
      state.players[sync.myId] = { name: 'Test', score: 0 }
      state.currentTurn = sync.myId
      state.phase = 'playing'
      
      expect(state.phase).toBe('playing')
    })
  })
})
