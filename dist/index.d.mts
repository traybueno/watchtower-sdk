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
interface WatchtowerConfig {
    /** Your game's unique identifier */
    gameId: string;
    /** Player ID (auto-generated if not provided) */
    playerId?: string;
    /** API base URL (default: https://watchtower-api.watchtower-host.workers.dev) */
    apiUrl?: string;
    /** API key for authenticated requests (optional for now) */
    apiKey?: string;
}
interface SaveData<T = unknown> {
    key: string;
    data: T;
}
interface PlayerInfo {
    id: string;
    joinedAt: number;
}
interface RoomInfo {
    code: string;
    gameId: string;
    hostId: string;
    players: PlayerInfo[];
    playerCount: number;
}
/** Game-wide stats */
interface GameStats {
    /** Players currently online */
    online: number;
    /** Unique players today (DAU) */
    today: number;
    /** Unique players this month (MAU) */
    monthly: number;
    /** Total unique players all time */
    total: number;
    /** Currently active rooms */
    rooms: number;
    /** Players currently in multiplayer rooms */
    inRooms: number;
    /** Average session length in seconds */
    avgSession: number;
    /** Average players per room */
    avgRoomSize: number;
    /** Last update timestamp */
    updatedAt: number | null;
}
/** Current player's stats */
interface PlayerStats {
    /** When the player first connected */
    firstSeen: string | null;
    /** When the player last connected */
    lastSeen: string | null;
    /** Total sessions */
    sessions: number;
    /** Total playtime in seconds */
    playtime: number;
}
/** Player state - position, animation, custom data */
type PlayerState = Record<string, unknown>;
/** All players' states indexed by player ID */
type PlayersState = Record<string, PlayerState>;
/** Shared game state - host controlled */
type GameState = Record<string, unknown>;
type RoomEventMap = {
    /** Fired when connected to room */
    connected: (info: {
        playerId: string;
        room: RoomInfo;
    }) => void;
    /** Fired when a player joins */
    playerJoined: (playerId: string, playerCount: number) => void;
    /** Fired when a player leaves */
    playerLeft: (playerId: string, playerCount: number) => void;
    /** Fired when players' states update (includes all players) */
    players: (players: PlayersState) => void;
    /** Fired when shared game state updates */
    state: (state: GameState) => void;
    /** Fired when host changes */
    hostChanged: (newHostId: string) => void;
    /** Fired when receiving a broadcast message */
    message: (from: string, data: unknown) => void;
    /** Fired on disconnect */
    disconnected: () => void;
    /** Fired on error */
    error: (error: Error) => void;
};
declare class PlayerStateManager {
    private room;
    private _state;
    private syncInterval;
    private dirty;
    private syncRateMs;
    constructor(room: Room, syncRateMs?: number);
    /** Set player state (merged with existing) */
    set(state: PlayerState): void;
    /** Replace entire player state */
    replace(state: PlayerState): void;
    /** Get current player state */
    get(): PlayerState;
    /** Clear player state */
    clear(): void;
    /** Start automatic sync */
    startSync(): void;
    /** Stop automatic sync */
    stopSync(): void;
    /** Force immediate sync */
    sync(): void;
}
declare class GameStateManager {
    private room;
    private _state;
    constructor(room: Room);
    /** Set game state (host only, merged with existing) */
    set(state: GameState): void;
    /** Replace entire game state (host only) */
    replace(state: GameState): void;
    /** Get current game state */
    get(): GameState;
    /** Update internal state (called on sync from server) */
    _update(state: GameState): void;
}
declare class Room {
    readonly code: string;
    private ws;
    private listeners;
    private config;
    /** Player state manager - set your position/state here */
    readonly player: PlayerStateManager;
    /** Game state manager - shared state (host-controlled) */
    readonly state: GameStateManager;
    /** All players' current states */
    private _players;
    /** Current host ID */
    private _hostId;
    /** Room info from initial connection */
    private _roomInfo;
    constructor(code: string, config: Required<WatchtowerConfig>);
    /** Get the current host ID */
    get hostId(): string;
    /** Check if current player is the host */
    get isHost(): boolean;
    /** Get current player's ID */
    get playerId(): string;
    /** Get all players' states */
    get players(): PlayersState;
    /** Get player count */
    get playerCount(): number;
    /** Connect to the room via WebSocket */
    connect(): Promise<void>;
    private handleMessage;
    /** Subscribe to room events */
    on<K extends keyof RoomEventMap>(event: K, callback: RoomEventMap[K]): void;
    /** Unsubscribe from room events */
    off<K extends keyof RoomEventMap>(event: K, callback: RoomEventMap[K]): void;
    private emit;
    /** Broadcast data to all players in the room (for one-off events) */
    broadcast(data: unknown, excludeSelf?: boolean): void;
    /** Send data to a specific player */
    sendTo(playerId: string, data: unknown): void;
    /** Send a ping to measure latency */
    ping(): void;
    /** Request host transfer (host only) */
    transferHost(newHostId: string): void;
    private send;
    /** Disconnect from the room */
    disconnect(): void;
    /** Check if connected */
    get connected(): boolean;
}
interface SyncOptions {
    /** Updates per second (default: 20) */
    tickRate?: number;
    /**
     * Smoothing mode for remote players (default: 'lerp')
     * - 'lerp': Frame-based lerping toward latest position. Zero latency, simple, great for casual games.
     * - 'interpolate': Time-based snapshot interpolation. Adds latency but more accurate for competitive games.
     * - 'none': No smoothing, positions snap immediately.
     */
    smoothing?: 'lerp' | 'interpolate' | 'none';
    /** Lerp factor - how fast to catch up to target (default: 0.15). Only used in 'lerp' mode. */
    lerpFactor?: number;
    /** @deprecated Use smoothing: 'interpolate' instead */
    interpolate?: boolean;
    /** Interpolation delay in ms - how far "in the past" to render others (default: 100). Only used in 'interpolate' mode. */
    interpolationDelay?: number;
    /** Jitter buffer size in ms - smooths network variance (default: 0). Only used in 'interpolate' mode. */
    jitterBuffer?: number;
    /** Enable auto-reconnection on disconnect (default: true) */
    autoReconnect?: boolean;
    /** Max reconnection attempts (default: 10) */
    maxReconnectAttempts?: number;
}
interface JoinOptions {
    /** Create room if it doesn't exist */
    create?: boolean;
    /** Max players (only on create) */
    maxPlayers?: number;
    /** Make room public/discoverable (only on create) */
    public?: boolean;
    /** Room metadata (only on create) */
    metadata?: Record<string, unknown>;
}
interface RoomListing {
    id: string;
    players: number;
    maxPlayers?: number;
    metadata?: Record<string, unknown>;
    createdAt: number;
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
declare class Sync<T extends Record<string, unknown>> {
    /** The synchronized state object */
    readonly state: T;
    /** Your player ID */
    readonly myId: string;
    /** Current room ID (null if not in a room) */
    get roomId(): string | null;
    /** Whether currently connected to a room */
    get connected(): boolean;
    /** Number of players in the current room */
    get playerCount(): number;
    /** Current latency to server in milliseconds */
    get latency(): number;
    private config;
    private options;
    private _roomId;
    private ws;
    private syncInterval;
    private interpolationInterval;
    private lastSentState;
    private listeners;
    private snapshots;
    private lerpTargets;
    private jitterQueue;
    private reconnectAttempts;
    private reconnectTimeout;
    private lastJoinOptions;
    private isReconnecting;
    private serverTimeOffset;
    private _playerCount;
    private _latency;
    private pingStartTime;
    private pingInterval;
    constructor(state: T, config: Required<WatchtowerConfig>, options?: SyncOptions);
    /**
     * Join a room - your state will sync with everyone in this room
     *
     * @param roomId - Room identifier (any string)
     * @param options - Join options
     */
    join(roomId: string, options?: JoinOptions): Promise<void>;
    /**
     * Leave the current room
     */
    leave(): Promise<void>;
    /**
     * Send a one-off message to all players in the room
     *
     * @param data - Any JSON-serializable data
     */
    broadcast(data: unknown): void;
    /**
     * Create a new room and join it
     *
     * @param options - Room creation options
     * @returns The room code/ID
     */
    create(options?: Omit<JoinOptions, 'create'>): Promise<string>;
    /**
     * List public rooms
     */
    listRooms(): Promise<RoomListing[]>;
    /**
     * Subscribe to sync events
     */
    on(event: 'join' | 'leave' | 'error' | 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'message', callback: Function): void;
    /**
     * Unsubscribe from sync events
     */
    off(event: string, callback: Function): void;
    private emit;
    private connectWebSocket;
    private handleMessage;
    private applyFullState;
    private applyPlayerState;
    private setLerpTarget;
    private addSnapshot;
    private applyStateDirect;
    private removePlayer;
    private attemptReconnect;
    private clearRemotePlayers;
    private findPlayersKey;
    private startSyncLoop;
    private startInterpolationLoop;
    /**
     * Frame-based lerping (gnome-chat style)
     * Lerps each remote player's position toward their target by lerpFactor each frame.
     * Simple, zero latency, great for casual games.
     */
    private updateLerp;
    private measureLatency;
    private stopInterpolationLoop;
    private processJitterQueue;
    private stopSyncLoop;
    private syncMyState;
    private updateInterpolation;
    private lerpState;
    private generateRoomCode;
    private getHeaders;
}
declare class Watchtower {
    /** @internal - Config is non-enumerable to prevent accidental API key exposure */
    private readonly config;
    constructor(config: WatchtowerConfig);
    private generatePlayerId;
    /** Get the current player ID */
    get playerId(): string;
    /** Get the game ID */
    get gameId(): string;
    private fetch;
    /**
     * Save data to the cloud
     * @param key - Save slot name (e.g., "progress", "settings")
     * @param data - Any JSON-serializable data
     */
    save(key: string, data: unknown): Promise<void>;
    /**
     * Load data from the cloud
     * @param key - Save slot name
     * @returns The saved data, or null if not found
     */
    load<T = unknown>(key: string): Promise<T | null>;
    /**
     * List all save keys for this player
     */
    listSaves(): Promise<string[]>;
    /**
     * Delete a save
     * @param key - Save slot name
     */
    deleteSave(key: string): Promise<void>;
    /**
     * Create a new multiplayer room
     * @returns A Room instance (already connected)
     */
    createRoom(): Promise<Room>;
    /**
     * Join an existing room by code
     * @param code - The 4-letter room code
     * @returns A Room instance (already connected)
     */
    joinRoom(code: string): Promise<Room>;
    /**
     * Get info about a room without joining
     * @param code - The 4-letter room code
     */
    getRoomInfo(code: string): Promise<RoomInfo>;
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
    getStats(): Promise<GameStats>;
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
    getPlayerStats(): Promise<PlayerStats>;
    /**
     * Track a session start (call on game load)
     * This is called automatically if you use createRoom/joinRoom
     */
    trackSessionStart(): Promise<void>;
    /**
     * Track a session end (call on game close)
     */
    trackSessionEnd(): Promise<void>;
    /**
     * Convenience getter for stats (same as getStats but as property style)
     * Note: This returns a promise, use `await wt.stats` or `wt.getStats()`
     */
    get stats(): Promise<GameStats>;
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
    sync<T extends Record<string, unknown>>(state: T, options?: SyncOptions): Sync<T>;
}

export { type GameState, type GameStats, type JoinOptions, type PlayerInfo, type PlayerState, type PlayerStats, type PlayersState, Room, type RoomEventMap, type RoomInfo, type RoomListing, type SaveData, Sync, type SyncOptions, Watchtower, type WatchtowerConfig, Watchtower as default };
