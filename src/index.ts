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

// ============ SYNC CLASS ============

export interface SyncOptions {
  /** Updates per second (default: 20) */
  tickRate?: number
  /** Enable interpolation for remote entities (default: true) */
  interpolate?: boolean
  /** Interpolation delay in ms - how far "in the past" to render others (default: 100) */
  interpolationDelay?: number
  /** Jitter buffer size in ms - smooths network variance (default: 50) */
  jitterBuffer?: number
  /** Enable auto-reconnection on disconnect (default: true) */
  autoReconnect?: boolean
  /** Max reconnection attempts (default: 10) */
  maxReconnectAttempts?: number
}

export interface JoinOptions {
  /** Create room if it doesn't exist */
  create?: boolean
  /** Max players (only on create) */
  maxPlayers?: number
  /** Make room public/discoverable (only on create) */
  public?: boolean
  /** Room metadata (only on create) */
  metadata?: Record<string, unknown>
}

export interface RoomListing {
  id: string
  players: number
  maxPlayers?: number
  metadata?: Record<string, unknown>
  createdAt: number
}

/**
 * Sync - Automatic state synchronization
 * 
 * Point this at your game state object and it becomes multiplayer.
 * No events, no callbacks - just read and write your state.
 * 
 * @example
 * ```ts
 * const state = { players: {} }
 * const sync = wt.sync(state)
 * 
 * await sync.join('my-room')
 * 
 * // Add yourself
 * state.players[sync.myId] = { x: 0, y: 0, name: 'Player1' }
 * 
 * // Move (automatically syncs to others)
 * state.players[sync.myId].x = 100
 * 
 * // Others appear automatically in state.players!
 * for (const [id, player] of Object.entries(state.players)) {
 *   draw(player.x, player.y)
 * }
 * ```
 */
export class Sync<T extends Record<string, unknown>> {
  /** The synchronized state object */
  readonly state: T
  
  /** Your player ID */
  readonly myId: string
  
  /** Current room ID (null if not in a room) */
  get roomId(): string | null {
    return this._roomId
  }
  
  /** Whether currently connected to a room */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private config: Required<WatchtowerConfig>
  private options: Required<SyncOptions>
  private _roomId: string | null = null
  private ws: WebSocket | null = null
  private syncInterval: ReturnType<typeof setInterval> | null = null
  private interpolationInterval: ReturnType<typeof setInterval> | null = null
  private lastSentState: string = ''
  private listeners: Map<string, Set<Function>> = new Map()
  
  // Snapshot-based interpolation: store timestamped snapshots per player
  private snapshots: Map<string, Array<{ time: number, state: Record<string, unknown> }>> = new Map()
  
  // Jitter buffer: queue incoming updates before applying
  private jitterQueue: Array<{ deliverAt: number, playerId: string, state: Record<string, unknown> }> = []
  
  // Auto-reconnect state
  private reconnectAttempts: number = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private lastJoinOptions: JoinOptions | undefined = undefined
  private isReconnecting: boolean = false

  constructor(state: T, config: Required<WatchtowerConfig>, options?: SyncOptions) {
    this.state = state
    this.myId = config.playerId
    this.config = config
    this.options = {
      tickRate: options?.tickRate ?? 20,
      interpolate: options?.interpolate ?? true,
      interpolationDelay: options?.interpolationDelay ?? 100,
      jitterBuffer: options?.jitterBuffer ?? 0, // 0 = immediate, set to 50+ for smoothing
      autoReconnect: options?.autoReconnect ?? true,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10
    }
  }

  /**
   * Join a room - your state will sync with everyone in this room
   * 
   * @param roomId - Room identifier (any string)
   * @param options - Join options
   */
  async join(roomId: string, options?: JoinOptions): Promise<void> {
    // Leave current room if any
    if (this._roomId && !this.isReconnecting) {
      await this.leave()
    }

    this._roomId = roomId
    this.lastJoinOptions = options
    this.reconnectAttempts = 0

    // Connect WebSocket
    await this.connectWebSocket(roomId, options)

    // Start sync loop
    this.startSyncLoop()
    
    // Start interpolation loop (60fps for smooth visuals)
    this.startInterpolationLoop()
  }

  /**
   * Leave the current room
   */
  async leave(): Promise<void> {
    // Cancel any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.isReconnecting = false
    
    this.stopSyncLoop()
    this.stopInterpolationLoop()
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    // Clear other players from state (keep our own data structure)
    this.clearRemotePlayers()
    
    // Clear interpolation data
    this.snapshots.clear()
    this.jitterQueue = []
    
    this._roomId = null
  }

  /**
   * Send a one-off message to all players in the room
   * 
   * @param data - Any JSON-serializable data
   */
  broadcast(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'broadcast', data }))
    }
  }

  /**
   * Create a new room and join it
   * 
   * @param options - Room creation options
   * @returns The room code/ID
   */
  async create(options?: Omit<JoinOptions, 'create'>): Promise<string> {
    // Generate a room code
    const code = this.generateRoomCode()
    await this.join(code, { ...options, create: true })
    return code
  }

  /**
   * List public rooms
   */
  async listRooms(): Promise<RoomListing[]> {
    const response = await fetch(`${this.config.apiUrl}/v1/sync/rooms?gameId=${this.config.gameId}`, {
      headers: this.getHeaders()
    })
    
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to list rooms')
    }
    
    const data = await response.json()
    return data.rooms || []
  }

  /**
   * Subscribe to sync events
   */
  on(event: 'join' | 'leave' | 'error' | 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'message', callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  /**
   * Unsubscribe from sync events
   */
  off(event: string, callback: Function): void {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach(cb => {
      try {
        cb(...args)
      } catch (e) {
        console.error(`Error in sync ${event} handler:`, e)
      }
    })
  }

  private async connectWebSocket(roomId: string, options?: JoinOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://')
      
      const params = new URLSearchParams({
        playerId: this.config.playerId,
        gameId: this.config.gameId,
        ...(this.config.apiKey ? { apiKey: this.config.apiKey } : {}),
        ...(options?.create ? { create: 'true' } : {}),
        ...(options?.maxPlayers ? { maxPlayers: String(options.maxPlayers) } : {}),
        ...(options?.public ? { public: 'true' } : {}),
        ...(options?.metadata ? { metadata: JSON.stringify(options.metadata) } : {})
      })
      
      const url = `${wsUrl}/v1/sync/${roomId}/ws?${params}`
      
      this.ws = new WebSocket(url)

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
        this.ws?.close()
      }, 10000)

      this.ws.onopen = () => {
        clearTimeout(timeout)
        this.emit('connected')
        resolve()
      }

      this.ws.onerror = () => {
        clearTimeout(timeout)
        const error = new Error('WebSocket connection failed')
        this.emit('error', error)
        reject(error)
      }

      this.ws.onclose = () => {
        this.stopSyncLoop()
        this.emit('disconnected')
        
        // Auto-reconnect if enabled and we were in a room
        if (this.options.autoReconnect && this._roomId && !this.isReconnecting) {
          this.attemptReconnect()
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this.handleMessage(data)
        } catch (e) {
          console.error('Failed to parse sync message:', e)
        }
      }
    })
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'full_state':
        // Late joiner - receive full state from server
        this.applyFullState(data.state)
        break

      case 'state':
        // Another player's state update
        this.applyPlayerState(data.playerId, data.data)
        break

      case 'join':
        // Player joined - they'll send their state soon
        this.emit('join', data.playerId)
        break

      case 'leave':
        // Player left - remove from state
        this.removePlayer(data.playerId)
        this.emit('leave', data.playerId)
        break

      case 'message':
        // Broadcast message from another player
        this.emit('message', data.from, data.data)
        break
    }
  }

  private applyFullState(fullState: Record<string, Record<string, unknown>>) {
    // Apply all players' states
    for (const [playerId, playerState] of Object.entries(fullState)) {
      if (playerId !== this.myId) {
        this.applyPlayerState(playerId, playerState)
      }
    }
  }

  private applyPlayerState(playerId: string, playerState: Record<string, unknown>) {
    if (this.options.interpolate && this.options.jitterBuffer > 0) {
      // Queue the update for jitter buffering
      this.jitterQueue.push({
        deliverAt: Date.now() + this.options.jitterBuffer,
        playerId,
        state: { ...playerState }
      })
    } else if (this.options.interpolate) {
      // No jitter buffer, but still use snapshots for interpolation
      this.addSnapshot(playerId, playerState)
    } else {
      // No interpolation - apply directly
      this.applyStateDirect(playerId, playerState)
    }
  }
  
  private addSnapshot(playerId: string, playerState: Record<string, unknown>) {
    const isNewPlayer = !this.snapshots.has(playerId)
    
    if (isNewPlayer) {
      this.snapshots.set(playerId, [])
    }
    
    const playerSnapshots = this.snapshots.get(playerId)!
    playerSnapshots.push({
      time: Date.now(),
      state: { ...playerState }
    })
    
    // Keep only last 10 snapshots (500ms at 20Hz)
    while (playerSnapshots.length > 10) {
      playerSnapshots.shift()
    }
    
    // Ensure player exists in state
    const playersKey = this.findPlayersKey()
    if (playersKey) {
      const players = this.state[playersKey] as Record<string, unknown>
      if (isNewPlayer || !players[playerId]) {
        // New player - apply state immediately (no prior data to interpolate from)
        players[playerId] = { ...playerState }
      }
      // Existing players get updated via updateInterpolation()
    }
  }
  
  private applyStateDirect(playerId: string, playerState: Record<string, unknown>) {
    const playersKey = this.findPlayersKey()
    if (!playersKey) return
    
    const players = this.state[playersKey] as Record<string, unknown>
    players[playerId] = playerState
  }

  private removePlayer(playerId: string) {
    const playersKey = this.findPlayersKey()
    if (!playersKey) return

    const players = this.state[playersKey] as Record<string, unknown>
    delete players[playerId]
    this.snapshots.delete(playerId)
  }
  
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'))
      return
    }
    
    this.isReconnecting = true
    this.reconnectAttempts++
    
    // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000)
    
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay })
    
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connectWebSocket(this._roomId!, this.lastJoinOptions)
        this.startSyncLoop()
        this.isReconnecting = false
        this.reconnectAttempts = 0
        this.emit('reconnected')
      } catch (e) {
        // Will trigger onclose which will retry
        this.isReconnecting = false
      }
    }, delay)
  }

  private clearRemotePlayers() {
    const playersKey = this.findPlayersKey()
    if (!playersKey) return

    const players = this.state[playersKey] as Record<string, unknown>
    for (const playerId of Object.keys(players)) {
      if (playerId !== this.myId) {
        delete players[playerId]
      }
    }
    this.snapshots.clear()
    this.jitterQueue = []
  }

  private findPlayersKey(): string | null {
    // Look for common player collection keys
    const candidates = ['players', 'entities', 'gnomes', 'users', 'clients']
    for (const key of candidates) {
      if (key in this.state && typeof this.state[key] === 'object') {
        return key
      }
    }
    // Return first object-type key as fallback
    for (const key of Object.keys(this.state)) {
      if (typeof this.state[key] === 'object' && this.state[key] !== null) {
        return key
      }
    }
    return null
  }

  private startSyncLoop() {
    if (this.syncInterval) return

    const intervalMs = 1000 / this.options.tickRate

    this.syncInterval = setInterval(() => {
      this.syncMyState()
    }, intervalMs)
  }
  
  private startInterpolationLoop() {
    if (this.interpolationInterval) return
    if (!this.options.interpolate) return
    
    // Run at 60fps for smooth visuals
    this.interpolationInterval = setInterval(() => {
      this.processJitterQueue()
      this.updateInterpolation()
    }, 16) // ~60fps
  }
  
  private stopInterpolationLoop() {
    if (this.interpolationInterval) {
      clearInterval(this.interpolationInterval)
      this.interpolationInterval = null
    }
  }
  
  private processJitterQueue() {
    const now = Date.now()
    const ready = this.jitterQueue.filter(item => item.deliverAt <= now)
    this.jitterQueue = this.jitterQueue.filter(item => item.deliverAt > now)
    
    for (const item of ready) {
      this.addSnapshot(item.playerId, item.state)
    }
  }

  private stopSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  private syncMyState() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const playersKey = this.findPlayersKey()
    if (!playersKey) return

    const players = this.state[playersKey] as Record<string, unknown>
    const myState = players[this.myId]
    
    if (!myState) return

    // Only send if changed
    const stateJson = JSON.stringify(myState)
    if (stateJson === this.lastSentState) return
    
    this.lastSentState = stateJson
    
    this.ws.send(JSON.stringify({
      type: 'state',
      data: myState
    }))
  }

  private updateInterpolation() {
    const playersKey = this.findPlayersKey()
    if (!playersKey) return

    const players = this.state[playersKey] as Record<string, Record<string, unknown>>
    
    // Render time is "now" minus interpolation delay (we show the past)
    const renderTime = Date.now() - this.options.interpolationDelay

    for (const [playerId, playerSnapshots] of this.snapshots) {
      if (playerId === this.myId) continue
      
      const player = players[playerId]
      if (!player) continue
      
      // Find the two snapshots surrounding renderTime
      let before: { time: number, state: Record<string, unknown> } | null = null
      let after: { time: number, state: Record<string, unknown> } | null = null
      
      for (const snapshot of playerSnapshots) {
        if (snapshot.time <= renderTime) {
          before = snapshot
        } else if (!after) {
          after = snapshot
        }
      }
      
      if (before && after) {
        // Interpolate between the two snapshots
        const total = after.time - before.time
        const elapsed = renderTime - before.time
        const alpha = total > 0 ? Math.min(1, elapsed / total) : 1
        
        this.lerpState(player, before.state, after.state, alpha)
      } else if (before) {
        // No future snapshot yet - extrapolate slightly or hold
        // For now, just use the latest known state
        this.lerpState(player, player, before.state, 0.3)
      } else if (after) {
        // Somehow we're behind (shouldn't happen often)
        this.lerpState(player, player, after.state, 0.3)
      }
    }
  }
  
  private lerpState(
    target: Record<string, unknown>,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    alpha: number
  ) {
    for (const key of Object.keys(to)) {
      const fromVal = from[key]
      const toVal = to[key]
      
      if (typeof fromVal === 'number' && typeof toVal === 'number') {
        // Linear interpolation for numbers
        target[key] = fromVal + (toVal - fromVal) * alpha
      } else {
        // Non-numeric: just use target value when alpha > 0.5
        if (alpha > 0.5) {
          target[key] = toVal
        }
      }
    }
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
    return code
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Player-ID': this.config.playerId,
      'X-Game-ID': this.config.gameId
    }
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }
    return headers
  }
}

// ============ MAIN CLASS ============

export class Watchtower {
  /** @internal - Config is non-enumerable to prevent accidental API key exposure */
  private readonly config!: Required<WatchtowerConfig>

  constructor(config: WatchtowerConfig) {
    // Define config as non-enumerable to prevent JSON.stringify from exposing API key
    Object.defineProperty(this, 'config', {
      value: {
        gameId: config.gameId,
        playerId: config.playerId || this.generatePlayerId(),
        apiUrl: config.apiUrl || 'https://watchtower-api.watchtower-host.workers.dev',
        apiKey: config.apiKey || ''
      },
      writable: false,
      enumerable: false,
      configurable: false
    })
  }

  private generatePlayerId(): string {
    // Check for existing ID in localStorage (browser) or generate new
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('watchtower_player_id')
        if (stored) return stored

        const id = 'player_' + Math.random().toString(36).substring(2, 11)
        localStorage.setItem('watchtower_player_id', id)
        return id
      }
    } catch {
      // localStorage may throw in some environments (e.g., sandboxed iframes)
      // Fall through to generate a new ID
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
      // Use !== undefined to handle falsy values like null, 0, false, ''
      body: body !== undefined ? JSON.stringify(body) : undefined
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

  // ============ SYNC API ============

  /**
   * Create a synchronized state object
   * 
   * Point this at your game state and it becomes multiplayer.
   * No events, no callbacks - just read and write your state.
   * 
   * @param state - Your game state object (e.g., { players: {} })
   * @param options - Sync options (tickRate, interpolation)
   * @returns A Sync instance
   * 
   * @example
   * ```ts
   * const state = { players: {} }
   * const sync = wt.sync(state)
   * 
   * await sync.join('my-room')
   * 
   * // Add yourself
   * state.players[sync.myId] = { x: 0, y: 0 }
   * 
   * // Move (automatically syncs to others)
   * state.players[sync.myId].x = 100
   * 
   * // Others appear automatically in state.players!
   * for (const [id, player] of Object.entries(state.players)) {
   *   draw(player.x, player.y)
   * }
   * ```
   */
  sync<T extends Record<string, unknown>>(state: T, options?: SyncOptions): Sync<T> {
    return new Sync(state, this.config, options)
  }
}

// Default export
export default Watchtower
