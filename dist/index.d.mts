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
interface RoomInfo {
    code: string;
    gameId: string;
    hostId: string;
    players: {
        id: string;
        joinedAt: number;
    }[];
    playerCount: number;
}
type RoomEventMap = {
    connected: (info: {
        playerId: string;
        room: RoomInfo;
    }) => void;
    playerJoined: (playerId: string, playerCount: number) => void;
    playerLeft: (playerId: string, playerCount: number) => void;
    message: (from: string, data: unknown) => void;
    disconnected: () => void;
    error: (error: Error) => void;
};
declare class Room {
    readonly code: string;
    private ws;
    private listeners;
    private config;
    constructor(code: string, config: Required<WatchtowerConfig>);
    /** Connect to the room via WebSocket */
    connect(): Promise<void>;
    private handleMessage;
    /** Subscribe to room events */
    on<K extends keyof RoomEventMap>(event: K, callback: RoomEventMap[K]): void;
    /** Unsubscribe from room events */
    off<K extends keyof RoomEventMap>(event: K, callback: RoomEventMap[K]): void;
    private emit;
    /** Broadcast data to all players in the room */
    broadcast(data: unknown, excludeSelf?: boolean): void;
    /** Send data to a specific player */
    sendTo(playerId: string, data: unknown): void;
    /** Send a ping to measure latency */
    ping(): void;
    private send;
    /** Disconnect from the room */
    disconnect(): void;
    /** Check if connected */
    get connected(): boolean;
}
declare class Watchtower {
    private config;
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
     * @returns A Room instance (call .connect() to join)
     */
    createRoom(): Promise<Room>;
    /**
     * Join an existing room by code
     * @param code - The 4-letter room code
     * @returns A Room instance
     */
    joinRoom(code: string): Promise<Room>;
    /**
     * Get info about a room without joining
     * @param code - The 4-letter room code
     */
    getRoomInfo(code: string): Promise<RoomInfo>;
}

export { Room, type RoomEventMap, type RoomInfo, type SaveData, Watchtower, type WatchtowerConfig, Watchtower as default };
