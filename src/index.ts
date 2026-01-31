/**
 * Watchtower SDK
 * Multiplayer infrastructure in one line. Your architecture.
 * 
 * @example
 * ```ts
 * import { connect } from '@watchtower/sdk'
 * 
 * const room = await connect('my-room')
 * 
 * // Send to everyone
 * room.broadcast({ x: 100, y: 200 })
 * 
 * // Receive messages
 * room.on('message', (from, data, meta) => {
 *   console.log(`${from} sent:`, data)
 *   console.log('Server time:', meta.serverTime)
 * })
 * 
 * // Room info
 * console.log('Players:', room.players)
 * console.log('Am I host?', room.isHost)
 * console.log('Share code:', room.code)
 * 
 * // Persistence
 * await room.save('progress', { level: 5 })
 * const data = await room.load('progress')
 * ```
 */

// ============ TYPES ============

export interface ConnectOptions {
  /** Your game ID (defaults to window.location.hostname) */
  gameId?: string
  /** Player ID (auto-generated if not provided) */
  playerId?: string
  /** API base URL */
  apiUrl?: string
  /** Create room if it doesn't exist (default: true) */
  create?: boolean
  /** Player display name */
  name?: string
  /** Player metadata (avatar, color, etc) */
  meta?: Record<string, unknown>
}

interface InternalConfig {
  roomId: string
  gameId: string
  playerId: string
  apiUrl: string
  create: boolean
  name?: string
  meta?: Record<string, unknown>
}

export interface Player {
  id: string
  name?: string
  meta?: Record<string, unknown>
  joinedAt: number
}

export interface MessageMeta {
  serverTime: number
  tick: number
}

export type MessageHandler = (from: string, data: unknown, meta: MessageMeta) => void
export type PlayerHandler = (player: Player) => void
export type VoidHandler = () => void

type EventMap = {
  message: MessageHandler
  join: PlayerHandler
  leave: PlayerHandler
  connected: VoidHandler
  disconnected: VoidHandler
  error: (error: Error) => void
}

// ============ ROOM CLASS ============

export class Room {
  private ws: WebSocket | null = null
  private listeners: Map<string, Set<Function>> = new Map()
  private config: InternalConfig
  private _players: Map<string, Player> = new Map()
  private _hostId: string = ''
  private _connected: boolean = false
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 10
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(roomId: string, config: ConnectOptions = {}) {
    this.config = {
      roomId,
      gameId: config.gameId || (typeof window !== 'undefined' ? window.location.hostname : 'default'),
      playerId: config.playerId || this.generatePlayerId(),
      apiUrl: config.apiUrl || 'https://watchtower-api.watchtower-host.workers.dev',
      create: config.create ?? true,
      name: config.name,
      meta: config.meta
    }
  }

  // === CONNECTION ===

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://')

      const params = new URLSearchParams({
        playerId: this.config.playerId,
        gameId: this.config.gameId,
        ...(this.config.create ? { create: 'true' } : {}),
        ...(this.config.name ? { name: this.config.name } : {}),
        ...(this.config.meta ? { meta: JSON.stringify(this.config.meta) } : {})
      })

      const url = `${wsUrl}/v1/connect/${this.config.roomId}/ws?${params}`
      this.ws = new WebSocket(url)

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
        this.ws?.close()
      }, 10000)

      this.ws.onopen = () => {
        clearTimeout(timeout)
        this._connected = true
        this.reconnectAttempts = 0
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
        this._connected = false
        this.emit('disconnected')
        this.attemptReconnect()
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          this.handleMessage(msg)
        } catch (e) {
          console.error('Failed to parse message:', e)
        }
      }
    })
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'welcome':
        this._hostId = msg.hostId || msg.room?.hostId || ''
        if (msg.players) {
          for (const p of msg.players) {
            this._players.set(p.id, p)
          }
        }
        break

      case 'join':
        const joinedPlayer: Player = {
          id: msg.playerId,
          name: msg.name,
          meta: msg.meta,
          joinedAt: msg.joinedAt || Date.now()
        }
        this._players.set(msg.playerId, joinedPlayer)
        this.emit('join', joinedPlayer)
        break

      case 'leave':
        const leftPlayer = this._players.get(msg.playerId)
        this._players.delete(msg.playerId)
        if (leftPlayer) this.emit('leave', leftPlayer)
        break

      case 'host_changed':
        this._hostId = msg.hostId
        break

      case 'message':
      case 'broadcast':
        this.emit('message', msg.from, msg.data, {
          serverTime: msg.serverTime || Date.now(),
          tick: msg.tick || 0
        })
        break

      case 'direct':
        this.emit('message', msg.from, msg.data, {
          serverTime: msg.serverTime || Date.now(),
          tick: msg.tick || 0
        })
        break

      case 'pong':
        // Could track latency here if needed
        break
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'))
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000)

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect()
      } catch (e) {
        // Will trigger onclose which retries
      }
    }, delay)
  }

  // === MESSAGING ===

  /** Send data to all players in the room */
  broadcast(data: unknown): void {
    this.send_ws({ type: 'broadcast', data })
  }

  /** Send data to a specific player */
  send(playerId: string, data: unknown): void {
    this.send_ws({ type: 'direct', to: playerId, data })
  }

  private send_ws(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  // === EVENTS ===

  on<K extends keyof EventMap>(event: K, callback: EventMap[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  off<K extends keyof EventMap>(event: K, callback: EventMap[K]): void {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args)
      } catch (e) {
        console.error(`Error in ${event} handler:`, e)
      }
    })
  }

  // === PERSISTENCE ===

  /** Save data to cloud storage (per-player) */
  async save(key: string, data: unknown): Promise<void> {
    const response = await fetch(
      `${this.config.apiUrl}/v1/saves/${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data)
      }
    )
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to save')
    }
  }

  /** Load data from cloud storage (per-player) */
  async load<T = unknown>(key: string): Promise<T | null> {
    const response = await fetch(
      `${this.config.apiUrl}/v1/saves/${encodeURIComponent(key)}`,
      {
        method: 'GET',
        headers: this.getHeaders()
      }
    )
    if (!response.ok) {
      if (response.status === 404) return null
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to load')
    }
    const result = await response.json()
    return result.data as T
  }

  /** Delete saved data */
  async delete(key: string): Promise<void> {
    const response = await fetch(
      `${this.config.apiUrl}/v1/saves/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
        headers: this.getHeaders()
      }
    )
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to delete')
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Player-ID': this.config.playerId,
      'X-Game-ID': this.config.gameId
    }
  }

  // === ROOM INFO ===

  /** Room code for sharing */
  get code(): string {
    return this.config.roomId
  }

  /** Your player ID */
  get playerId(): string {
    return this.config.playerId
  }

  /** Current host player ID */
  get hostId(): string {
    return this._hostId
  }

  /** Are you the host? */
  get isHost(): boolean {
    return this._hostId === this.config.playerId
  }

  /** List of players in the room */
  get players(): Player[] {
    return Array.from(this._players.values())
  }

  /** Number of players in the room */
  get playerCount(): number {
    return this._players.size
  }

  /** Is WebSocket connected? */
  get connected(): boolean {
    return this._connected
  }

  // === LIFECYCLE ===

  /** Leave the room and disconnect */
  leave(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts // Prevent reconnect
    this.ws?.close()
    this.ws = null
    this._connected = false
    this._players.clear()
  }

  // === UTILS ===

  private generatePlayerId(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('watchtower_player_id')
      if (stored) return stored
      const id = 'p_' + Math.random().toString(36).substring(2, 11)
      localStorage.setItem('watchtower_player_id', id)
      return id
    }
    return 'p_' + Math.random().toString(36).substring(2, 11)
  }
}

// ============ CONNECT FUNCTION ============

/**
 * Connect to a room. Creates the room if it doesn't exist.
 * 
 * @param roomId - Room code (any string, or leave empty to auto-generate)
 * @param options - Connection options
 * @returns Connected Room instance
 * 
 * @example
 * ```ts
 * // Join or create a room
 * const room = await connect('my-room')
 * 
 * // Create a new room with auto-generated code
 * const room = await connect()
 * console.log('Share this:', room.code)
 * 
 * // With options
 * const room = await connect('my-room', {
 *   name: 'Player1',
 *   meta: { avatar: 'knight', color: '#ff0000' }
 * })
 * ```
 */
export async function connect(roomId?: string, options?: ConnectOptions): Promise<Room> {
  const code = roomId || generateRoomCode()
  const room = new Room(code, options)
  await room.connect()
  return room
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ============ EXPORTS ============

export default { connect, Room }
