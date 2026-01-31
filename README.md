# @watchtower-sdk/core

The simplest way to add multiplayer to your game. Point at your state, join a room, done.

## Installation

```bash
npm install @watchtower-sdk/core
```

## Quick Start

```typescript
import { Watchtower } from '@watchtower-sdk/core'

const wt = new Watchtower({
  gameId: 'my-game',
  apiKey: 'wt_live_...'  // Get from watchtower.host
})

// Your game state
const state = { players: {} }

// Make it multiplayer
const sync = wt.sync(state)
await sync.join('my-room')

// Add yourself
state.players[sync.myId] = { x: 0, y: 0, name: 'Player1' }

// Move (automatically syncs!)
state.players[sync.myId].x += 10

// Others appear automatically in state.players
for (const [id, player] of Object.entries(state.players)) {
  drawPlayer(player.x, player.y)
}
```

No events. No message handlers. Just read and write your state.

---

## State Templates

Pick the pattern that matches your game:

### Movement Game (Cursor Party, Agar.io)

```typescript
interface GameState {
  players: Record<string, {
    x: number
    y: number
    name: string
    color: string
  }>
}

const state: GameState = { players: {} }
const sync = wt.sync(state, { 
  interpolate: true,
  interpolationDelay: 100,
  jitterBuffer: 50
})
```

### Chat / Lobby

```typescript
interface GameState {
  players: Record<string, {
    name: string
    avatar: string
    ready: boolean
  }>
  messages: Array<{
    from: string
    text: string
    ts: number
  }>
}

const state: GameState = { players: {}, messages: [] }
const sync = wt.sync(state, { interpolate: false })  // No movement = no interpolation needed
```

### Turn-Based (Chess, Cards)

```typescript
interface GameState {
  players: Record<string, {
    name: string
    hand?: Card[]  // Hidden from others in real implementation
  }>
  currentTurn: string
  board: BoardState
  phase: 'waiting' | 'playing' | 'finished'
}

const state: GameState = { 
  players: {}, 
  currentTurn: '', 
  board: initialBoard,
  phase: 'waiting'
}
const sync = wt.sync(state, { interpolate: false })
```

### Action Game (Shooter, Brawler)

```typescript
interface GameState {
  players: Record<string, {
    x: number
    y: number
    vx: number  // Velocity helps with prediction
    vy: number
    health: number
    facing: 'left' | 'right'
    animation: string
  }>
}

const state: GameState = { players: {} }
const sync = wt.sync(state, {
  interpolate: true,
  interpolationDelay: 50,  // Lower for faster games
  jitterBuffer: 25
})
```

---

## Smoothing Options

The SDK automatically smooths remote player movement. Configure based on your game type:

```typescript
const sync = wt.sync(state, {
  // Core settings
  tickRate: 20,              // Updates per second (default: 20)
  interpolate: true,         // Smooth remote movement (default: true)
  
  // Smoothing tuning
  interpolationDelay: 100,   // Render others Xms in the past (default: 100)
  jitterBuffer: 50,          // Buffer packets Xms to smooth delivery (default: 0)
  
  // Connection handling
  autoReconnect: true,       // Auto-reconnect on disconnect (default: true)
  maxReconnectAttempts: 10   // Give up after X attempts (default: 10)
})
```

### Recommended Presets

| Game Type | interpolationDelay | jitterBuffer | Notes |
|-----------|-------------------|--------------|-------|
| Casual (cursor party) | 100ms | 50ms | Buttery smooth, slight delay |
| Action (platformer) | 50ms | 25ms | Responsive, still smooth |
| Fast (shooter) | 40ms | 20ms | Very responsive |
| Turn-based | 0ms | 0ms | Instant, no movement to smooth |

**Why the delay?** The SDK renders other players slightly "in the past" using server timestamps. This allows it to interpolate between known positions instead of guessing. 100ms is imperceptible for casual games but makes movement silky smooth.

---

## Properties

```typescript
sync.myId        // Your player ID
sync.roomId      // Current room ID, or null
sync.connected   // WebSocket connected?
sync.playerCount // Players in room
sync.latency     // RTT to server in ms
```

---

## Rooms

```typescript
// Create a new room
const code = await sync.create({ maxPlayers: 4 })
console.log('Share this code:', code)  // e.g., "A3B7X2"

// Join existing room
await sync.join('A3B7X2')

// Leave room
await sync.leave()

// List public rooms
const rooms = await sync.listRooms()
```

---

## Events

You don't *need* events — just read your state. But if you want notifications:

```typescript
// Player events
sync.on('join', (playerId) => console.log(`${playerId} joined`))
sync.on('leave', (playerId) => console.log(`${playerId} left`))

// Connection events
sync.on('connected', () => console.log('Connected!'))
sync.on('disconnected', () => console.log('Disconnected'))
sync.on('reconnecting', ({ attempt, delay }) => console.log(`Reconnecting in ${delay}ms...`))
sync.on('reconnected', () => console.log('Reconnected!'))

// Error handling
sync.on('error', (err) => console.error(err))
```

---

## Broadcast Messages

For one-off events that don't belong in state (explosions, sound effects):

```typescript
// Send
sync.broadcast({ type: 'explosion', x: 100, y: 200 })

// Receive
sync.on('message', (from, data) => {
  if (data.type === 'explosion') {
    playExplosion(data.x, data.y)
  }
})
```

---

## Cloud Saves

Simple key-value storage per player:

```typescript
// Save
await wt.save('progress', { level: 5, coins: 100 })

// Load
const progress = await wt.load('progress')

// List all saves
const keys = await wt.listSaves()  // ['progress']

// Delete
await wt.deleteSave('progress')
```

---

## Full Example

```typescript
import { Watchtower } from '@watchtower-sdk/core'

const wt = new Watchtower({ gameId: 'my-game', apiKey: 'wt_...' })

// State template: movement game
const state = { 
  players: {} as Record<string, { x: number; y: number; color: string }>
}

const sync = wt.sync(state, {
  interpolate: true,
  interpolationDelay: 100,
  jitterBuffer: 50
})

// Join or create room
const code = prompt('Room code? (blank to create)')
if (code) {
  await sync.join(code)
} else {
  const newCode = await sync.create()
  alert('Share: ' + newCode)
}

// Add yourself
state.players[sync.myId] = {
  x: Math.random() * 800,
  y: Math.random() * 600,
  color: '#' + Math.floor(Math.random()*16777215).toString(16)
}

// Game loop
function loop() {
  // Move
  if (keys.left)  state.players[sync.myId].x -= 5
  if (keys.right) state.players[sync.myId].x += 5
  if (keys.up)    state.players[sync.myId].y -= 5
  if (keys.down)  state.players[sync.myId].y += 5
  
  // Draw everyone (others are auto-interpolated!)
  ctx.clearRect(0, 0, 800, 600)
  for (const [id, p] of Object.entries(state.players)) {
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - 10, p.y - 10, 20, 20)
    
    // Show latency for your player
    if (id === sync.myId) {
      ctx.fillText(`${sync.latency}ms`, p.x, p.y - 15)
    }
  }
  
  // Debug info
  ctx.fillStyle = '#fff'
  ctx.fillText(`Players: ${sync.playerCount}`, 10, 20)
  
  requestAnimationFrame(loop)
}
loop()
```

---

## Best Practices

1. **Keep state flat.** Nested objects sync fine, but flat is faster to diff.

2. **Use the `players` key.** The SDK auto-detects `players`, `entities`, `users`, or `clients`.

3. **Don't store secrets in state.** Everyone sees everything. Use server-side validation for game logic.

4. **Let the SDK interpolate.** Don't add your own smoothing on top — it'll fight the SDK.

5. **Test with "Open another tab".** Easiest way to see multiplayer working.

---

## License

MIT
