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
}

export { type GameState, type GameStats, type PlayerInfo, type PlayerState, type PlayerStats, type PlayersState, Room, type RoomEventMap, type RoomInfo, type SaveData, Watchtower, type WatchtowerConfig, Watchtower as default };
