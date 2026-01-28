/**
 * Watchtower SDK
 * Simple game backend - saves, multiplayer rooms, and more
 * 
 * @example
 * ```ts
 * import { Watchtower } from '@watchtower/sdk'
 * 
 * const wt = new Watchtower({ gameId: 'my-game' })
 * 
 * // Cloud saves
 * await wt.save('progress', { level: 5, coins: 100 })
 * const data = await wt.load('progress')
 * 
 * // Multiplayer
 * const room = await wt.createRoom()
 * console.log('Room code:', room.code) // e.g., "ABCD"
 * 
 * room.on('playerJoined', (playerId) => { ... })
 * room.on('message', (from, data) => { ... })
 * room.broadcast({ x: 100, y: 200 })
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

export interface RoomInfo {
  code: string
  gameId: string
  hostId: string
  players: { id: string; joinedAt: number }[]
  playerCount: number
}

export type RoomEventMap = {
  connected: (info: { playerId: string; room: RoomInfo }) => void
  playerJoined: (playerId: string, playerCount: number) => void
  playerLeft: (playerId: string, playerCount: number) => void
  message: (from: string, data: unknown) => void
  disconnected: () => void
  error: (error: Error) => void
}

// ============ ROOM CLASS ============

export class Room {
  readonly code: string
  private ws: WebSocket | null = null
  private listeners: Map<string, Set<Function>> = new Map()
  private config: Required<WatchtowerConfig>

  constructor(code: string, config: Required<WatchtowerConfig>) {
    this.code = code
    this.config = config
  }

  /** Connect to the room via WebSocket */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://')
      
      const url = `${wsUrl}/v1/rooms/${this.code}/ws?playerId=${this.config.playerId}`
      
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        resolve()
      }

      this.ws.onerror = (event) => {
        const error = new Error('WebSocket connection failed')
        this.emit('error', error)
        reject(error)
      }

      this.ws.onclose = () => {
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
        this.emit('connected', {
          playerId: data.playerId,
          room: data.room
        })
        break

      case 'player_joined':
        this.emit('playerJoined', data.playerId, data.playerCount)
        break

      case 'player_left':
        this.emit('playerLeft', data.playerId, data.playerCount)
        break

      case 'message':
        this.emit('message', data.from, data.data)
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

  /** Broadcast data to all players in the room */
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

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('WebSocket not connected')
    }
  }

  /** Disconnect from the room */
  disconnect(): void {
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
   * @returns A Room instance (call .connect() to join)
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
   * @returns A Room instance
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
}

// Default export
export default Watchtower
