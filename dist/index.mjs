// src/index.ts
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
var Sync = class {
  constructor(state, config, options) {
    this._roomId = null;
    this.ws = null;
    this.syncInterval = null;
    this.interpolationInterval = null;
    this.lastSentState = "";
    this.listeners = /* @__PURE__ */ new Map();
    // Snapshot-based interpolation: store timestamped snapshots per player
    this.snapshots = /* @__PURE__ */ new Map();
    // Jitter buffer: queue incoming updates before applying
    this.jitterQueue = [];
    // Auto-reconnect state
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.lastJoinOptions = void 0;
    this.isReconnecting = false;
    // Server time sync and metrics
    this.serverTimeOffset = 0;
    // Local time - server time
    this._playerCount = 1;
    this._latency = 0;
    this.pingStartTime = 0;
    this.pingInterval = null;
    this.state = state;
    this.myId = config.playerId;
    this.config = config;
    this.options = {
      tickRate: options?.tickRate ?? 20,
      interpolate: options?.interpolate ?? true,
      interpolationDelay: options?.interpolationDelay ?? 100,
      jitterBuffer: options?.jitterBuffer ?? 0,
      // 0 = immediate, set to 50+ for smoothing
      autoReconnect: options?.autoReconnect ?? true,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10
    };
  }
  /** Current room ID (null if not in a room) */
  get roomId() {
    return this._roomId;
  }
  /** Whether currently connected to a room */
  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  /** Number of players in the current room */
  get playerCount() {
    return this._playerCount;
  }
  /** Current latency to server in milliseconds */
  get latency() {
    return this._latency;
  }
  /**
   * Join a room - your state will sync with everyone in this room
   * 
   * @param roomId - Room identifier (any string)
   * @param options - Join options
   */
  async join(roomId, options) {
    if (this._roomId && !this.isReconnecting) {
      await this.leave();
    }
    this._roomId = roomId;
    this.lastJoinOptions = options;
    this.reconnectAttempts = 0;
    await this.connectWebSocket(roomId, options);
    this.startSyncLoop();
    this.startInterpolationLoop();
  }
  /**
   * Leave the current room
   */
  async leave() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    this.stopSyncLoop();
    this.stopInterpolationLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.clearRemotePlayers();
    this.snapshots.clear();
    this.jitterQueue = [];
    this._roomId = null;
  }
  /**
   * Send a one-off message to all players in the room
   * 
   * @param data - Any JSON-serializable data
   */
  broadcast(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "broadcast", data }));
    }
  }
  /**
   * Create a new room and join it
   * 
   * @param options - Room creation options
   * @returns The room code/ID
   */
  async create(options) {
    const code = this.generateRoomCode();
    await this.join(code, { ...options, create: true });
    return code;
  }
  /**
   * List public rooms
   */
  async listRooms() {
    const response = await fetch(`${this.config.apiUrl}/v1/sync/rooms?gameId=${this.config.gameId}`, {
      headers: this.getHeaders()
    });
    if (!response.ok) {
      const data2 = await response.json();
      throw new Error(data2.error || "Failed to list rooms");
    }
    const data = await response.json();
    return data.rooms || [];
  }
  /**
   * Subscribe to sync events
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(callback);
  }
  /**
   * Unsubscribe from sync events
   */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }
  emit(event, ...args) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch (e) {
        console.error(`Error in sync ${event} handler:`, e);
      }
    });
  }
  async connectWebSocket(roomId, options) {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.apiUrl.replace("https://", "wss://").replace("http://", "ws://");
      const params = new URLSearchParams({
        playerId: this.config.playerId,
        gameId: this.config.gameId,
        ...this.config.apiKey ? { apiKey: this.config.apiKey } : {},
        ...options?.create ? { create: "true" } : {},
        ...options?.maxPlayers ? { maxPlayers: String(options.maxPlayers) } : {},
        ...options?.public ? { public: "true" } : {},
        ...options?.metadata ? { metadata: JSON.stringify(options.metadata) } : {}
      });
      const url = `${wsUrl}/v1/sync/${roomId}/ws?${params}`;
      this.ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        this.ws?.close();
      }, 1e4);
      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.emit("connected");
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timeout);
        const error = new Error("WebSocket connection failed");
        this.emit("error", error);
        reject(error);
      };
      this.ws.onclose = () => {
        this.stopSyncLoop();
        this.emit("disconnected");
        if (this.options.autoReconnect && this._roomId && !this.isReconnecting) {
          this.attemptReconnect();
        }
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error("Failed to parse sync message:", e);
        }
      };
    });
  }
  handleMessage(data) {
    if (data.serverTime) {
      this.serverTimeOffset = Date.now() - data.serverTime;
    }
    switch (data.type) {
      case "welcome":
        if (data.state) {
          this.applyFullState(data.state);
        }
        this._playerCount = data.playerCount || 1;
        this.emit("welcome", { playerCount: data.playerCount, tick: data.tick });
        break;
      case "full_state":
        this.applyFullState(data.state);
        break;
      case "state":
        this.applyPlayerState(data.playerId, data.data, data.serverTime);
        break;
      case "join":
        this._playerCount = data.playerCount || this._playerCount + 1;
        this.emit("join", data.playerId);
        break;
      case "leave":
        this._playerCount = data.playerCount || Math.max(1, this._playerCount - 1);
        this.removePlayer(data.playerId);
        this.emit("leave", data.playerId);
        break;
      case "message":
        this.emit("message", data.from, data.data);
        break;
      case "pong":
        if (this.pingStartTime) {
          this._latency = Date.now() - this.pingStartTime;
          this._playerCount = data.playerCount || this._playerCount;
        }
        break;
    }
  }
  applyFullState(fullState) {
    for (const [playerId, playerState] of Object.entries(fullState)) {
      if (playerId !== this.myId) {
        this.applyPlayerState(playerId, playerState);
      }
    }
  }
  applyPlayerState(playerId, playerState, serverTime) {
    const timestamp = serverTime ? serverTime + this.serverTimeOffset : Date.now();
    if (this.options.interpolate && this.options.jitterBuffer > 0) {
      this.jitterQueue.push({
        deliverAt: timestamp + this.options.jitterBuffer,
        playerId,
        state: { ...playerState },
        timestamp
      });
    } else if (this.options.interpolate) {
      this.addSnapshot(playerId, playerState, timestamp);
    } else {
      this.applyStateDirect(playerId, playerState);
    }
  }
  addSnapshot(playerId, playerState, timestamp) {
    const isNewPlayer = !this.snapshots.has(playerId);
    if (isNewPlayer) {
      this.snapshots.set(playerId, []);
    }
    const playerSnapshots = this.snapshots.get(playerId);
    playerSnapshots.push({
      time: timestamp || Date.now(),
      state: { ...playerState }
    });
    while (playerSnapshots.length > 10) {
      playerSnapshots.shift();
    }
    const playersKey = this.findPlayersKey();
    if (playersKey) {
      const players = this.state[playersKey];
      if (isNewPlayer || !players[playerId]) {
        players[playerId] = { ...playerState };
      }
    }
  }
  applyStateDirect(playerId, playerState) {
    const playersKey = this.findPlayersKey();
    if (!playersKey) return;
    const players = this.state[playersKey];
    players[playerId] = playerState;
  }
  removePlayer(playerId) {
    const playersKey = this.findPlayersKey();
    if (!playersKey) return;
    const players = this.state[playersKey];
    delete players[playerId];
    this.snapshots.delete(playerId);
  }
  attemptReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnection attempts reached"));
      return;
    }
    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(1e3 * Math.pow(2, this.reconnectAttempts - 1), 3e4);
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connectWebSocket(this._roomId, this.lastJoinOptions);
        this.startSyncLoop();
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.emit("reconnected");
      } catch (e) {
        this.isReconnecting = false;
      }
    }, delay);
  }
  clearRemotePlayers() {
    const playersKey = this.findPlayersKey();
    if (!playersKey) return;
    const players = this.state[playersKey];
    for (const playerId of Object.keys(players)) {
      if (playerId !== this.myId) {
        delete players[playerId];
      }
    }
    this.snapshots.clear();
    this.jitterQueue = [];
  }
  findPlayersKey() {
    const candidates = ["players", "entities", "gnomes", "users", "clients"];
    for (const key of candidates) {
      if (key in this.state && typeof this.state[key] === "object") {
        return key;
      }
    }
    for (const key of Object.keys(this.state)) {
      if (typeof this.state[key] === "object" && this.state[key] !== null) {
        return key;
      }
    }
    return null;
  }
  startSyncLoop() {
    if (this.syncInterval) return;
    const intervalMs = 1e3 / this.options.tickRate;
    this.syncInterval = setInterval(() => {
      this.syncMyState();
    }, intervalMs);
  }
  startInterpolationLoop() {
    if (this.interpolationInterval) return;
    if (!this.options.interpolate) return;
    this.interpolationInterval = setInterval(() => {
      this.processJitterQueue();
      this.updateInterpolation();
    }, 16);
    this.pingInterval = setInterval(() => {
      this.measureLatency();
    }, 2e3);
  }
  measureLatency() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.pingStartTime = Date.now();
      this.ws.send(JSON.stringify({ type: "ping" }));
    }
  }
  stopInterpolationLoop() {
    if (this.interpolationInterval) {
      clearInterval(this.interpolationInterval);
      this.interpolationInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  processJitterQueue() {
    const now = Date.now();
    const ready = this.jitterQueue.filter((item) => item.deliverAt <= now);
    this.jitterQueue = this.jitterQueue.filter((item) => item.deliverAt > now);
    for (const item of ready) {
      this.addSnapshot(item.playerId, item.state, item.timestamp);
    }
  }
  stopSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
  syncMyState() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const playersKey = this.findPlayersKey();
    if (!playersKey) return;
    const players = this.state[playersKey];
    const myState = players[this.myId];
    if (!myState) return;
    const stateJson = JSON.stringify(myState);
    if (stateJson === this.lastSentState) return;
    this.lastSentState = stateJson;
    this.ws.send(JSON.stringify({
      type: "state",
      data: myState
    }));
  }
  updateInterpolation() {
    const playersKey = this.findPlayersKey();
    if (!playersKey) return;
    const players = this.state[playersKey];
    const renderTime = Date.now() - this.options.interpolationDelay;
    for (const [playerId, playerSnapshots] of this.snapshots) {
      if (playerId === this.myId) continue;
      const player = players[playerId];
      if (!player) continue;
      let before = null;
      let after = null;
      for (const snapshot of playerSnapshots) {
        if (snapshot.time <= renderTime) {
          before = snapshot;
        } else if (!after) {
          after = snapshot;
        }
      }
      if (before && after) {
        const total = after.time - before.time;
        const elapsed = renderTime - before.time;
        const alpha = total > 0 ? Math.min(1, elapsed / total) : 1;
        this.lerpState(player, before.state, after.state, alpha);
      } else if (before) {
        this.lerpState(player, player, before.state, 0.3);
      } else if (after) {
        this.lerpState(player, player, after.state, 0.3);
      }
    }
  }
  lerpState(target, from, to, alpha) {
    for (const key of Object.keys(to)) {
      const fromVal = from[key];
      const toVal = to[key];
      if (typeof fromVal === "number" && typeof toVal === "number") {
        target[key] = fromVal + (toVal - fromVal) * alpha;
      } else {
        if (alpha > 0.5) {
          target[key] = toVal;
        }
      }
    }
  }
  generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
  getHeaders() {
    const headers = {
      "Content-Type": "application/json",
      "X-Player-ID": this.config.playerId,
      "X-Game-ID": this.config.gameId
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
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
  sync(state, options) {
    return new Sync(state, this.config, options);
  }
};
var index_default = Watchtower;
export {
  Room,
  Sync,
  Watchtower,
  index_default as default
};
