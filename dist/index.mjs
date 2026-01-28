// src/index.ts
var Room = class {
  constructor(code, config) {
    this.ws = null;
    this.listeners = /* @__PURE__ */ new Map();
    this.code = code;
    this.config = config;
  }
  /** Connect to the room via WebSocket */
  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl.replace("https://", "wss://").replace("http://", "ws://");
      const url = `${wsUrl}/v1/rooms/${this.code}/ws?playerId=${this.config.playerId}`;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        resolve();
      };
      this.ws.onerror = (event) => {
        const error = new Error("WebSocket connection failed");
        this.emit("error", error);
        reject(error);
      };
      this.ws.onclose = () => {
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
        this.emit("connected", {
          playerId: data.playerId,
          room: data.room
        });
        break;
      case "player_joined":
        this.emit("playerJoined", data.playerId, data.playerCount);
        break;
      case "player_left":
        this.emit("playerLeft", data.playerId, data.playerCount);
        break;
      case "message":
        this.emit("message", data.from, data.data);
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
  /** Broadcast data to all players in the room */
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
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket not connected");
    }
  }
  /** Disconnect from the room */
  disconnect() {
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
    this.config = {
      gameId: config.gameId,
      playerId: config.playerId || this.generatePlayerId(),
      apiUrl: config.apiUrl || "https://watchtower-api.watchtower-host.workers.dev",
      apiKey: config.apiKey || ""
    };
  }
  generatePlayerId() {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("watchtower_player_id");
      if (stored) return stored;
      const id = "player_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem("watchtower_player_id", id);
      return id;
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
      body: body ? JSON.stringify(body) : void 0
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
   * @returns A Room instance (call .connect() to join)
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
   * @returns A Room instance
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
};
var index_default = Watchtower;
export {
  Room,
  Watchtower,
  index_default as default
};
