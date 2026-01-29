"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Room: () => Room,
  Watchtower: () => Watchtower,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var PlayerStateManager = class {
  constructor(room, syncRateMs = 50) {
    this._state = {};
    this.syncInterval = null;
    this.dirty = false;
    this.room = room;
    this.syncRateMs = syncRateMs;
  }
  /** Set player state (merged with existing) */
  set(state) {
    this._state = { ...this._state, ...state };
    this.dirty = true;
  }
  /** Replace entire player state */
  replace(state) {
    this._state = state;
    this.dirty = true;
  }
  /** Get current player state */
  get() {
    return { ...this._state };
  }
  /** Clear player state */
  clear() {
    this._state = {};
    this.dirty = true;
  }
  /** Start automatic sync */
  startSync() {
    if (this.syncInterval) return;
    this.syncInterval = setInterval(() => {
      if (this.dirty) {
        this.room["send"]({ type: "player_state", state: this._state });
        this.dirty = false;
      }
    }, this.syncRateMs);
  }
  /** Stop automatic sync */
  stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
  /** Force immediate sync */
  sync() {
    this.room["send"]({ type: "player_state", state: this._state });
    this.dirty = false;
  }
};
var GameStateManager = class {
  constructor(room) {
    this._state = {};
    this.room = room;
  }
  /** Set game state (host only, merged with existing) */
  set(state) {
    if (!this.room.isHost) {
      console.warn("Only the host can set game state");
      return;
    }
    this._state = { ...this._state, ...state };
    this.room["send"]({ type: "game_state", state: this._state });
  }
  /** Replace entire game state (host only) */
  replace(state) {
    if (!this.room.isHost) {
      console.warn("Only the host can set game state");
      return;
    }
    this._state = state;
    this.room["send"]({ type: "game_state", state: this._state });
  }
  /** Get current game state */
  get() {
    return { ...this._state };
  }
  /** Update internal state (called on sync from server) */
  _update(state) {
    this._state = state;
  }
};
var Room = class {
  constructor(code, config) {
    this.ws = null;
    this.listeners = /* @__PURE__ */ new Map();
    /** All players' current states */
    this._players = {};
    /** Current host ID */
    this._hostId = "";
    /** Room info from initial connection */
    this._roomInfo = null;
    this.code = code;
    this.config = config;
    this.player = new PlayerStateManager(this);
    this.state = new GameStateManager(this);
  }
  /** Get the current host ID */
  get hostId() {
    return this._hostId;
  }
  /** Check if current player is the host */
  get isHost() {
    return this._hostId === this.config.playerId;
  }
  /** Get current player's ID */
  get playerId() {
    return this.config.playerId;
  }
  /** Get all players' states */
  get players() {
    return { ...this._players };
  }
  /** Get player count */
  get playerCount() {
    return Object.keys(this._players).length;
  }
  /** Connect to the room via WebSocket */
  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl.replace("https://", "wss://").replace("http://", "ws://");
      const params = new URLSearchParams({
        playerId: this.config.playerId,
        ...this.config.apiKey ? { apiKey: this.config.apiKey } : {}
      });
      const url = `${wsUrl}/v1/rooms/${this.code}/ws?${params}`;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.player.startSync();
        resolve();
      };
      this.ws.onerror = () => {
        const error = new Error("WebSocket connection failed");
        this.emit("error", error);
        reject(error);
      };
      this.ws.onclose = () => {
        this.player.stopSync();
        this.emit("disconnected");
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e);
        }
      };
    });
  }
  handleMessage(data) {
    switch (data.type) {
      case "connected":
        this._hostId = data.room.hostId;
        this._roomInfo = data.room;
        if (data.playerStates) {
          this._players = data.playerStates;
        }
        if (data.gameState) {
          this.state._update(data.gameState);
        }
        this.emit("connected", {
          playerId: data.playerId,
          room: data.room
        });
        break;
      case "player_joined":
        this.emit("playerJoined", data.playerId, data.playerCount);
        break;
      case "player_left":
        delete this._players[data.playerId];
        this.emit("playerLeft", data.playerId, data.playerCount);
        this.emit("players", this._players);
        break;
      case "players_sync":
        this._players = data.players;
        this.emit("players", this._players);
        break;
      case "player_state_update":
        this._players[data.playerId] = data.state;
        this.emit("players", this._players);
        break;
      case "game_state_sync":
        this.state._update(data.state);
        this.emit("state", data.state);
        break;
      case "host_changed":
        this._hostId = data.hostId;
        this.emit("hostChanged", data.hostId);
        break;
      case "message":
        this.emit("message", data.from, data.data);
        break;
      case "pong":
        break;
    }
  }
  /** Subscribe to room events */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(callback);
  }
  /** Unsubscribe from room events */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }
  emit(event, ...args) {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(...args);
      } catch (e) {
        console.error(`Error in ${event} handler:`, e);
      }
    });
  }
  /** Broadcast data to all players in the room (for one-off events) */
  broadcast(data, excludeSelf = true) {
    this.send({ type: "broadcast", data, excludeSelf });
  }
  /** Send data to a specific player */
  sendTo(playerId, data) {
    this.send({ type: "send", to: playerId, data });
  }
  /** Send a ping to measure latency */
  ping() {
    this.send({ type: "ping" });
  }
  /** Request host transfer (host only) */
  transferHost(newHostId) {
    if (!this.isHost) {
      console.warn("Only the host can transfer host");
      return;
    }
    this.send({ type: "transfer_host", newHostId });
  }
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket not connected");
    }
  }
  /** Disconnect from the room */
  disconnect() {
    this.player.stopSync();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  /** Check if connected */
  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
};
var Watchtower = class {
  constructor(config) {
    Object.defineProperty(this, "config", {
      value: {
        gameId: config.gameId,
        playerId: config.playerId || this.generatePlayerId(),
        apiUrl: config.apiUrl || "https://watchtower-api.watchtower-host.workers.dev",
        apiKey: config.apiKey || ""
      },
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  generatePlayerId() {
    try {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem("watchtower_player_id");
        if (stored) return stored;
        const id = "player_" + Math.random().toString(36).substring(2, 11);
        localStorage.setItem("watchtower_player_id", id);
        return id;
      }
    } catch {
    }
    return "player_" + Math.random().toString(36).substring(2, 11);
  }
  /** Get the current player ID */
  get playerId() {
    return this.config.playerId;
  }
  /** Get the game ID */
  get gameId() {
    return this.config.gameId;
  }
  // ============ HTTP HELPERS ============
  async fetch(method, path, body) {
    const headers = {
      "Content-Type": "application/json",
      "X-Player-ID": this.config.playerId,
      "X-Game-ID": this.config.gameId
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers,
      // Use !== undefined to handle falsy values like null, 0, false, ''
      body: body !== void 0 ? JSON.stringify(body) : void 0
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }
  // ============ SAVES API ============
  /**
   * Save data to the cloud
   * @param key - Save slot name (e.g., "progress", "settings")
   * @param data - Any JSON-serializable data
   */
  async save(key, data) {
    await this.fetch("POST", `/v1/saves/${encodeURIComponent(key)}`, data);
  }
  /**
   * Load data from the cloud
   * @param key - Save slot name
   * @returns The saved data, or null if not found
   */
  async load(key) {
    try {
      const result = await this.fetch("GET", `/v1/saves/${encodeURIComponent(key)}`);
      return result.data;
    } catch (e) {
      if (e.message === "Save not found") {
        return null;
      }
      throw e;
    }
  }
  /**
   * List all save keys for this player
   */
  async listSaves() {
    const result = await this.fetch("GET", "/v1/saves");
    return result.keys;
  }
  /**
   * Delete a save
   * @param key - Save slot name
   */
  async deleteSave(key) {
    await this.fetch("DELETE", `/v1/saves/${encodeURIComponent(key)}`);
  }
  // ============ ROOMS API ============
  /**
   * Create a new multiplayer room
   * @returns A Room instance (already connected)
   */
  async createRoom() {
    const result = await this.fetch("POST", "/v1/rooms");
    const room = new Room(result.code, this.config);
    await room.connect();
    return room;
  }
  /**
   * Join an existing room by code
   * @param code - The 4-letter room code
   * @returns A Room instance (already connected)
   */
  async joinRoom(code) {
    code = code.toUpperCase().trim();
    await this.fetch("POST", `/v1/rooms/${code}/join`);
    const room = new Room(code, this.config);
    await room.connect();
    return room;
  }
  /**
   * Get info about a room without joining
   * @param code - The 4-letter room code
   */
  async getRoomInfo(code) {
    code = code.toUpperCase().trim();
    return this.fetch("GET", `/v1/rooms/${code}`);
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
  async getStats() {
    return this.fetch("GET", "/v1/stats");
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
  async getPlayerStats() {
    return this.fetch("GET", "/v1/stats/player");
  }
  /**
   * Track a session start (call on game load)
   * This is called automatically if you use createRoom/joinRoom
   */
  async trackSessionStart() {
    await this.fetch("POST", "/v1/stats/track", { event: "session_start" });
  }
  /**
   * Track a session end (call on game close)
   */
  async trackSessionEnd() {
    await this.fetch("POST", "/v1/stats/track", { event: "session_end" });
  }
  /**
   * Convenience getter for stats (same as getStats but as property style)
   * Note: This returns a promise, use `await wt.stats` or `wt.getStats()`
   */
  get stats() {
    return this.getStats();
  }
};
var index_default = Watchtower;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Room,
  Watchtower
});
