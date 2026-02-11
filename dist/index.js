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
  connect: () => connect,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var Room = class {
  constructor(roomId, config = {}) {
    this.ws = null;
    this.listeners = /* @__PURE__ */ new Map();
    this._players = /* @__PURE__ */ new Map();
    this._hostId = "";
    this._connected = false;
    this._history = [];
    this._wasKicked = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimeout = null;
    this.config = {
      roomId,
      gameId: config.gameId || (typeof window !== "undefined" ? window.location.hostname : "default"),
      playerId: config.playerId || this.generatePlayerId(),
      apiUrl: config.apiUrl || "https://watchtower-api.watchtower-host.workers.dev",
      create: config.create ?? true,
      name: config.name,
      meta: config.meta,
      debug: config.debug ?? false
    };
  }
  // === DEBUG LOGGING ===
  log(...args) {
    if (this.config.debug) {
      console.log("[Watchtower]", ...args);
    }
  }
  // === CONNECTION ===
  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl.replace("https://", "wss://").replace("http://", "ws://");
      const params = new URLSearchParams({
        playerId: this.config.playerId,
        gameId: this.config.gameId,
        create: this.config.create ? "true" : "false",
        ...this.config.name ? { name: this.config.name } : {},
        ...this.config.meta ? { meta: JSON.stringify(this.config.meta) } : {}
      });
      const url = `${wsUrl}/v1/connect/${this.config.roomId}/ws?${params}`;
      this.log("Connecting to", this.config.roomId);
      this.ws = new WebSocket(url);
      let welcomed = false;
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        this.ws?.close();
      }, 1e4);
      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
      };
      this.ws.onerror = () => {
        clearTimeout(timeout);
        const error = new Error("WebSocket connection failed");
        this.emit("error", error);
        reject(error);
      };
      this.ws.onclose = () => {
        this._connected = false;
        this.emit("disconnected");
        if (welcomed && !this._wasKicked) {
          this.attemptReconnect();
        }
      };
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== "pong") {
            this.log("\u2190", msg.type, msg);
          }
          if (msg.type === "welcome" && !welcomed) {
            welcomed = true;
            clearTimeout(timeout);
            this.handleMessage(msg);
            this.emit("connected");
            this.log("Connected!", "playerId:", this.config.playerId, "isHost:", this.isHost);
            resolve();
          } else {
            this.handleMessage(msg);
          }
        } catch (e) {
          console.error("Failed to parse message:", e);
        }
      };
    });
  }
  handleMessage(msg) {
    switch (msg.type) {
      case "welcome":
        this._hostId = msg.hostId || msg.room?.hostId || "";
        if (msg.players) {
          for (const p of msg.players) {
            this._players.set(p.id, p);
          }
        }
        if (msg.recentEvents && Array.isArray(msg.recentEvents)) {
          this._history = msg.recentEvents;
        }
        break;
      case "join":
        const joinedPlayer = {
          id: msg.playerId,
          name: msg.name,
          meta: msg.meta,
          joinedAt: msg.joinedAt || Date.now()
        };
        this._players.set(msg.playerId, joinedPlayer);
        this.log("Player joined:", msg.playerId, msg.name || "");
        this.emit("join", joinedPlayer);
        break;
      case "leave":
        const leftPlayer = this._players.get(msg.playerId);
        this._players.delete(msg.playerId);
        this.log("Player left:", msg.playerId);
        if (leftPlayer) this.emit("leave", leftPlayer);
        break;
      case "host_changed":
        this._hostId = msg.hostId;
        this.log("Host changed to:", msg.hostId);
        break;
      case "message":
      case "broadcast":
        this.emit("message", msg.from, msg.data, {
          serverTime: msg.serverTime || Date.now(),
          tick: msg.tick || 0
        });
        break;
      case "direct":
        this.emit("message", msg.from, msg.data, {
          serverTime: msg.serverTime || Date.now(),
          tick: msg.tick || 0
        });
        break;
      case "kicked":
        if (msg.playerId === this.config.playerId) {
          this._wasKicked = true;
          this.log("You were kicked:", msg.reason || "No reason given");
          this.emit("kicked", msg.reason);
          this.ws?.close();
        } else {
          const kickedPlayer = this._players.get(msg.playerId);
          this._players.delete(msg.playerId);
          this.log("Player kicked:", msg.playerId, msg.reason || "");
          if (kickedPlayer) this.emit("leave", kickedPlayer);
        }
        break;
      case "pong":
        break;
    }
  }
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnection attempts reached"));
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1e3 * Math.pow(2, this.reconnectAttempts - 1), 3e4);
    this.log("Reconnecting in", delay, "ms (attempt", this.reconnectAttempts, ")");
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
      } catch (e) {
      }
    }, delay);
  }
  // === MESSAGING ===
  /** Send data to all players in the room */
  broadcast(data) {
    this.log("\u2192 broadcast", data);
    this.send_ws({ type: "broadcast", data });
  }
  /** Send data to a specific player */
  send(playerId, data) {
    this.log("\u2192 direct to", playerId, data);
    this.send_ws({ type: "direct", to: playerId, data });
  }
  send_ws(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
  // === HOST ACTIONS ===
  /**
   * Kick a player from the room (host only)
   * @param playerId - Player ID to kick
   * @param reason - Optional reason for the kick
   */
  kick(playerId, reason) {
    if (!this.isHost) {
      this.log("Cannot kick - not the host");
      throw new Error("Only the host can kick players");
    }
    if (playerId === this.config.playerId) {
      throw new Error("Cannot kick yourself");
    }
    this.log("\u2192 kick", playerId, reason || "");
    this.send_ws({ type: "kick", playerId, reason });
  }
  // === EVENTS ===
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(callback);
  }
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }
  emit(event, ...args) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (e) {
        console.error(`Error in ${event} handler:`, e);
      }
    });
  }
  // === ROOM INFO ===
  /** Room code for sharing */
  get code() {
    return this.config.roomId;
  }
  /** Your player ID */
  get playerId() {
    return this.config.playerId;
  }
  /** Current host player ID */
  get hostId() {
    return this._hostId;
  }
  /** Are you the host? */
  get isHost() {
    return this._hostId === this.config.playerId;
  }
  /** List of players in the room */
  get players() {
    return Array.from(this._players.values());
  }
  /** Number of players in the room */
  get playerCount() {
    return this._players.size;
  }
  /** Is WebSocket connected? */
  get connected() {
    return this._connected;
  }
  /** Recent events from the room (messages, joins, leaves) */
  get history() {
    return [...this._history];
  }
  // === LIFECYCLE ===
  /** Leave the room and disconnect */
  leave() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.ws?.close();
    this.ws = null;
    this._connected = false;
    this._players.clear();
  }
  // === UTILS ===
  generatePlayerId() {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("watchtower_player_id");
      if (stored) return stored;
      const id = "p_" + this.randomId();
      localStorage.setItem("watchtower_player_id", id);
      return id;
    }
    return "p_" + this.randomId();
  }
  randomId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "").substring(0, 12);
    }
    return Math.random().toString(36).substring(2, 11);
  }
};
async function connect(roomId, options) {
  const code = roomId || generateRoomCode();
  const room = new Room(code, options);
  await room.connect();
  return room;
}
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
var index_default = { connect, Room };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Room,
  connect
});
