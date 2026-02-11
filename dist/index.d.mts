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
 * // Kick a player (host only)
 * if (room.isHost) {
 *   room.kick('player123', 'Breaking rules')
 * }
 * ```
 */
interface ConnectOptions {
    /** Your game ID (defaults to window.location.hostname) */
    gameId?: string;
    /** Player ID (auto-generated if not provided) */
    playerId?: string;
    /** API base URL */
    apiUrl?: string;
    /** Create room if it doesn't exist (default: true) */
    create?: boolean;
    /** Player display name */
    name?: string;
    /** Player metadata (avatar, color, etc) */
    meta?: Record<string, unknown>;
    /** Enable debug logging (default: false) */
    debug?: boolean;
}
interface Player {
    id: string;
    name?: string;
    meta?: Record<string, unknown>;
    joinedAt: number;
}
interface MessageMeta {
    serverTime: number;
    tick: number;
}
/** Event stored in history */
interface HistoryEvent {
    type: string;
    serverTime: number;
    tick: number;
    [key: string]: unknown;
}
type MessageHandler = (from: string, data: unknown, meta: MessageMeta) => void;
type PlayerHandler = (player: Player) => void;
type VoidHandler = () => void;
type KickedHandler = (reason?: string) => void;
type EventMap = {
    message: MessageHandler;
    join: PlayerHandler;
    leave: PlayerHandler;
    connected: VoidHandler;
    disconnected: VoidHandler;
    kicked: KickedHandler;
    error: (error: Error) => void;
};
declare class Room {
    private ws;
    private listeners;
    private config;
    private _players;
    private _hostId;
    private _connected;
    private _history;
    private _wasKicked;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectTimeout;
    constructor(roomId: string, config?: ConnectOptions);
    private log;
    connect(): Promise<void>;
    private handleMessage;
    private attemptReconnect;
    /** Send data to all players in the room */
    broadcast(data: unknown): void;
    /** Send data to a specific player */
    send(playerId: string, data: unknown): void;
    private send_ws;
    /**
     * Kick a player from the room (host only)
     * @param playerId - Player ID to kick
     * @param reason - Optional reason for the kick
     */
    kick(playerId: string, reason?: string): void;
    on<K extends keyof EventMap>(event: K, callback: EventMap[K]): void;
    off<K extends keyof EventMap>(event: K, callback: EventMap[K]): void;
    private emit;
    /** Room code for sharing */
    get code(): string;
    /** Your player ID */
    get playerId(): string;
    /** Current host player ID */
    get hostId(): string;
    /** Are you the host? */
    get isHost(): boolean;
    /** List of players in the room */
    get players(): Player[];
    /** Number of players in the room */
    get playerCount(): number;
    /** Is WebSocket connected? */
    get connected(): boolean;
    /** Recent events from the room (messages, joins, leaves) */
    get history(): HistoryEvent[];
    /** Leave the room and disconnect */
    leave(): void;
    private generatePlayerId;
    private randomId;
}
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
 *
 * // With debug logging
 * const room = await connect('my-room', { debug: true })
 * ```
 */
declare function connect(roomId?: string, options?: ConnectOptions): Promise<Room>;
declare const _default: {
    connect: typeof connect;
    Room: typeof Room;
};

export { type ConnectOptions, type HistoryEvent, type KickedHandler, type MessageHandler, type MessageMeta, type Player, type PlayerHandler, Room, type VoidHandler, connect, _default as default };
