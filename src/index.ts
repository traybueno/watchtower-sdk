/**
 * Watchtower SDK
 * Simple game backend - saves, multiplayer rooms, and more
 * 
 * @example
 * ```ts
 * import { Watchtower } from '@watchtower/sdk'
 * 
 * const wt = new Watchtower({ gameId: 'my-game', apiKey: 'wt_...' })
 * 
 * // Cloud saves
 * await wt.save('progress', { level: 5, coins: 100 })
 * const data = await wt.load('progress')
 * 
 * // Multiplayer
 * const room = await wt.createRoom()
 * console.log('Room code:', room.code) // e.g., "ABCD"
 * 
 * // Player state (auto-synced to others)
 * room.player.set({ x: 100, y: 200, sprite: 'idle' })
 * 
 * // See other players
 * room.on('players', (players) => {
 *   for (const [id, state] of Object.entries(players)) {
 *     updatePlayer(id, state)
 *   }
 * })
 * 
 * // Shared game state (host-controlled)
 * if (room.isHost) {
 *   room.state.set({ phase: 'playing', round: 1 })
 * }
 * room.on('state', (state) => updateGameState(state))
 * 
 * // One-off events
 * room.broadcast({ type: 'explosion', x: 50, y: 50 })
 * room.on('message', (from, data) => handleEvent(from, data))
 * ```
 */

// ============ TYPES ============

export interface WatchtowerConfig {
  /** Your game's unique identifier */
  gameId: string
  /** Player ID (auto-generated if not provided) */
  playerId?: string
  /** API base URL (default: https://watchtower-api.watchtower-host.workers.dev) */
  apiUrl?: string
  /** API key for authenticated requests (optional for now) */
  apiKey?: string
}

export interface SaveData<T = unknown> {
  key: string
  data: T
}

export interface PlayerInfo {
  id: string
  joinedAt: number
}

export interface RoomInfo {
  code: string
  gameId: string
  hostId: string
  players: PlayerInfo[]
  playerCount: number
}

/** Game-wide stats */
export interface GameStats {
  /** Players currently online */
  online: number
  /** Unique players today (DAU) */
  today: number
  /** Unique players this month (MAU) */
  monthly: number
  /** Total unique players all time */
  total: number
  /** Currently active rooms */
  rooms: number
  /** Players currently in multiplayer rooms */
  inRooms: number
  /** Average session length in seconds */
  avgSession: number
  /** Average players per room */
  avgRoomSize: number
  /** Last update timestamp */
  updatedAt: number | null
}

/** Current player's stats */
export interface PlayerStats {
  /** When the player first connected */
  firstSeen: string | null
  /** When the player last connected */
  lastSeen: string | null
  /** Total sessions */
  sessions: number
  /** Total playtime in seconds */
  playtime: number
}

/** Player state - position, animation, custom data */
export type PlayerState = Record<string, unknown>

/** All players' states indexed by player ID */
export type PlayersState = Record<string, PlayerState>

/** Shared game state - host controlled */
export type GameState = Record<string, unknown>

export type RoomEventMap = {
  /** Fired when connected to room */
  connected: (info: { playerId: string; room: RoomInfo }) => void
  /** Fired when a player joins */
  playerJoined: (playerId: string, playerCount: number) => void
  /** Fired when a player leaves */
  playerLeft: (playerId: string, playerCount: number) => void
  /** Fired when players' states update (includes all players) */
  players: (players: PlayersState) => void
  /** Fired when shared game state updates */
  state: (state: GameState) => void
  /** Fired when host changes */
  hostChanged: (newHostId: string) => void
  /** Fired when receiving a broadcast message */
  message: (from: string, data: unknown) => void
  /** Fired on disconnect */
  disconnected: () => void
  /** Fired on error */
  error: (error: Error) => void
}

// ============ PLAYER STATE MANAGER ============

class PlayerStateManager {
  private room: Room
  private _state: PlayerState = {}
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private dirty = false
  private syncRateMs: number

  constructor(room: Room, syncRateMs = 50) { // 20Hz default
    this.room = room
    this.syncRateMs = syncRateMs
  }

  /** Set player state (merged with existing) */
  set(state: PlayerState): void {
    this._state = { ...this._state, ...state }
    this.dirty = true
  }

  /** Replace entire player state */
  replace(state: PlayerState): void {
    this._state = state
    this.dirty = true
  }

  /** Get current player state */
  get(): PlayerState {
    return { ...this._state }
  }

  /** Clear player state */
  clear(): void {
    this._state = {}
    this.dirty = true
  }

  /** Start automatic sync */
  startSync(): void {
    if (this.syncInterval) return
    
    this.syncInterval = setInterval(() => {
      if (this.dirty) {
        this.room['send']({ type: 'player_state', state: this._state })
        this.dirty = false
      }
    }, this.syncRateMs)
  }

  /** Stop automatic sync */
  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  /** Force immediate sync */
  sync(): void {
    this.room['send']({ type: 'player_state', state: this._state })
    this.dirty = false
  }
}

// ============ GAME STATE MANAGER ============

class GameStateManager {
  private room: Room
  private _state: GameState = {}

  constructor(room: Room) {
    this.room = room
  }

  /** Set game state (host only, merged with existing) */
  set(state: GameState): void {
    if (!this.room.isHost) {
      console.warn('Only the host can set game state')
      return
    }
    this._state = { ...this._state, ...state }
    this.room['send']({ type: 'game_state', state: this._state })
  }

  /** Replace entire game state (host only) */
  replace(state: GameState): void {
    if (!this.room.isHost) {
      console.warn('Only the host can set game state')
      return
    }
    this._state = state
    this.room['send']({ type: 'game_state', state: this._state })
  }

  /** Get current game state */
  get(): GameState {
    return { ...this._state }
  }

  /** Update internal state (called on sync from server) */
  _update(state: GameState): void {
    this._state = state
  }
}

// ============ ROOM CLASS ============

export class Room {
  readonly code: string
  private ws: WebSocket | null = null
  private listeners: Map<string, Set<Function>> = new Map()
  private config: Required<WatchtowerConfig>
  
  /** Player state manager - set your position/state here */
  readonly player: PlayerStateManager
  
  /** Game state manager - shared state (host-controlled) */
  readonly state: GameStateManager
  
  /** All players' current states */
  private _players: PlayersState = {}
  
  /** Current host ID */
  private _hostId: string = ''
  
  /** Room info from initial connection */
  private _roomInfo: RoomInfo | null = null

  constructor(code: string, config: Required<WatchtowerConfig>) {
    this.code = code
    this.config = config
    this.player = new PlayerStateManager(this)
    this.state = new GameStateManager(this)
  }

  /** Get the current host ID */
  get hostId(): string {
    return this._hostId
  }

  /** Check if current player is the host */
  get isHost(): boolean {
    return this._hostId === this.config.playerId
  }

  /** Get current player's ID */
  get playerId(): string {
    return this.config.playerId
  }

  /** Get all players' states */
  get players(): PlayersState {
    return { ...this._players }
  }

  /** Get player count */
  get playerCount(): number {
    return Object.keys(this._players).length
  }

  /** Connect to the room via WebSocket */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://')
      
      // Include apiKey in URL since WebSocket can't send custom headers
      const params = new URLSearchParams({
        playerId: this.config.playerId,
        ...(this.config.apiKey ? { apiKey: this.config.apiKey } : {})
      })
      const url = `${wsUrl}/v1/rooms/${this.code}/ws?${params}`
      
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        // Start player state sync after connection
        this.player.startSync()
        resolve()
      }

      this.ws.onerror = () => {
        const error = new Error('WebSocket connection failed')
        this.emit('error', error)
        reject(error)
      }

      this.ws.onclose = () => {
        this.player.stopSync()
        this.emit('disconnected')
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this.handleMessage(data)
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e)
        }
      }
    })
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'connected':
        this._hostId = data.room.hostId
        this._roomInfo = data.room
        // Initialize players state
        if (data.playerStates) {
          this._players = data.playerStates
        }
        // Initialize game state
        if (data.gameState) {
          this.state._update(data.gameState)
        }
        this.emit('connected', {
          playerId: data.playerId,
          room: data.room
        })
        break

      case 'player_joined':
        this.emit('playerJoined', data.playerId, data.playerCount)
        break

      case 'player_left':
        // Remove player from local state
        delete this._players[data.playerId]
        this.emit('playerLeft', data.playerId, data.playerCount)
        this.emit('players', this._players)
        break

      case 'players_sync':
        // Full sync of all player states
        this._players = data.players
        this.emit('players', this._players)
        break

      case 'player_state_update':
        // Single player state update
        this._players[data.playerId] = data.state
        this.emit('players', this._players)
        break

      case 'game_state_sync':
        // Game state update from host
        this.state._update(data.state)
        this.emit('state', data.state)
        break

      case 'host_changed':
        this._hostId = data.hostId
        this.emit('hostChanged', data.hostId)
        break

      case 'message':
        this.emit('message', data.from, data.data)
        break

      case 'pong':
        // Could emit a latency event here
        break
    }
  }

  /** Subscribe to room events */
  on<K extends keyof RoomEventMap>(event: K, callback: RoomEventMap[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  /** Unsubscribe from room events */
  off<K extends keyof RoomEventMap>(event: K, callback: RoomEventMap[K]): void {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(...args)
      } catch (e) {
        console.error(`Error in ${event} handler:`, e)
      }
    })
  }

  /** Broadcast data to all players in the room (for one-off events) */
  broadcast(data: unknown, excludeSelf = true): void {
    this.send({ type: 'broadcast', data, excludeSelf })
  }

  /** Send data to a specific player */
  sendTo(playerId: string, data: unknown): void {
    this.send({ type: 'send', to: playerId, data })
  }

  /** Send a ping to measure latency */
  ping(): void {
    this.send({ type: 'ping' })
  }

  /** Request host transfer (host only) */
  transferHost(newHostId: string): void {
    if (!this.isHost) {
      console.warn('Only the host can transfer host')
      return
    }
    this.send({ type: 'transfer_host', newHostId })
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('WebSocket not connected')
    }
  }

  /** Disconnect from the room */
  disconnect(): void {
    this.player.stopSync()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /** Check if connected */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// ============ MAIN CLASS ============

export class Watchtower {
  private config: Required<WatchtowerConfig>

  constructor(config: WatchtowerConfig) {
    this.config = {
      gameId: config.gameId,
      playerId: config.playerId || this.generatePlayerId(),
      apiUrl: config.apiUrl || 'https://watchtower-api.watchtower-host.workers.dev',
      apiKey: config.apiKey || ''
    }
  }

  private generatePlayerId(): string {
    // Check for existing ID in localStorage (browser) or generate new
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('watchtower_player_id')
      if (stored) return stored

      const id = 'player_' + Math.random().toString(36).substring(2, 11)
      localStorage.setItem('watchtower_player_id', id)
      return id
    }
    return 'player_' + Math.random().toString(36).substring(2, 11)
  }

  /** Get the current player ID */
  get playerId(): string {
    return this.config.playerId
  }

  /** Get the game ID */
  get gameId(): string {
    return this.config.gameId
  }

  // ============ HTTP HELPERS ============

  private async fetch<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Player-ID': this.config.playerId,
      'X-Game-ID': this.config.gameId
    }

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }

    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`)
    }

    return data as T
  }

  // ============ SAVES API ============

  /**
   * Save data to the cloud
   * @param key - Save slot name (e.g., "progress", "settings")
   * @param data - Any JSON-serializable data
   */
  async save(key: string, data: unknown): Promise<void> {
    await this.fetch('POST', `/v1/saves/${encodeURIComponent(key)}`, data)
  }

  /**
   * Load data from the cloud
   * @param key - Save slot name
   * @returns The saved data, or null if not found
   */
  async load<T = unknown>(key: string): Promise<T | null> {
    try {
      const result = await this.fetch<SaveData<T>>('GET', `/v1/saves/${encodeURIComponent(key)}`)
      return result.data
    } catch (e: any) {
      if (e.message === 'Save not found') {
        return null
      }
      throw e
    }
  }

  /**
   * List all save keys for this player
   */
  async listSaves(): Promise<string[]> {
    const result = await this.fetch<{ keys: string[] }>('GET', '/v1/saves')
    return result.keys
  }

  /**
   * Delete a save
   * @param key - Save slot name
   */
  async deleteSave(key: string): Promise<void> {
    await this.fetch('DELETE', `/v1/saves/${encodeURIComponent(key)}`)
  }

  // ============ ROOMS API ============

  /**
   * Create a new multiplayer room
   * @returns A Room instance (already connected)
   */
  async createRoom(): Promise<Room> {
    const result = await this.fetch<{ code: string }>('POST', '/v1/rooms')
    const room = new Room(result.code, this.config)
    await room.connect()
    return room
  }

  /**
   * Join an existing room by code
   * @param code - The 4-letter room code
   * @returns A Room instance (already connected)
   */
  async joinRoom(code: string): Promise<Room> {
    code = code.toUpperCase().trim()
    await this.fetch('POST', `/v1/rooms/${code}/join`)
    const room = new Room(code, this.config)
    await room.connect()
    return room
  }

  /**
   * Get info about a room without joining
   * @param code - The 4-letter room code
   */
  async getRoomInfo(code: string): Promise<RoomInfo> {
    code = code.toUpperCase().trim()
    return this.fetch<RoomInfo>('GET', `/v1/rooms/${code}`)
  }

  // ============ STATS API ============

  /**
   * Get game-wide stats
   * @returns Stats like online players, DAU, rooms active, etc.
   * 
   * @example
   * ```ts
   * const stats = await wt.getStats()
   * console.log(`${stats.online} players online`)
   * console.log(`${stats.rooms} active rooms`)
   * ```
   */
  async getStats(): Promise<GameStats> {
    return this.fetch<GameStats>('GET', '/v1/stats')
  }

  /**
   * Get the current player's stats
   * @returns Player's firstSeen, sessions count, playtime
   * 
   * @example
   * ```ts
   * const me = await wt.getPlayerStats()
   * console.log(`You've played ${Math.floor(me.playtime / 3600)} hours`)
   * console.log(`Member since ${new Date(me.firstSeen).toLocaleDateString()}`)
   * ```
   */
  async getPlayerStats(): Promise<PlayerStats> {
    return this.fetch<PlayerStats>('GET', '/v1/stats/player')
  }

  /**
   * Track a session start (call on game load)
   * This is called automatically if you use createRoom/joinRoom
   */
  async trackSessionStart(): Promise<void> {
    await this.fetch('POST', '/v1/stats/track', { event: 'session_start' })
  }

  /**
   * Track a session end (call on game close)
   */
  async trackSessionEnd(): Promise<void> {
    await this.fetch('POST', '/v1/stats/track', { event: 'session_end' })
  }

  /**
   * Convenience getter for stats (same as getStats but as property style)
   * Note: This returns a promise, use `await wt.stats` or `wt.getStats()`
   */
  get stats(): Promise<GameStats> {
    return this.getStats()
  }
}

// Default export
export default Watchtower
