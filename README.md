# @watchtower-sdk/core

Simple game backend SDK - cloud saves and multiplayer.

## Installation

```bash
npm install @watchtower-sdk/core
```

## Quick Start

```typescript
import { Watchtower } from '@watchtower-sdk/core'

const wt = new Watchtower({
  gameId: 'my-game',
  apiKey: 'wt_live_...' // Get from dashboard
})

// Cloud saves
await wt.save('progress', { level: 5 })
const data = await wt.load('progress')

// Multiplayer
const state = { players: {} }
const sync = wt.sync(state)
await sync.join('room-code')
state.players[sync.myId] = { x: 0, y: 0 }
// Others appear in state.players automatically!
```

## Cloud Saves

Key-value storage per player. JSON in, JSON out.

```typescript
// Save
await wt.save('progress', { level: 5, coins: 100 })
await wt.save('settings', { music: true, sfx: true })

// Load
const progress = await wt.load('progress')
const settings = await wt.load('settings')

// List all saves
const keys = await wt.listSaves() // ['progress', 'settings']

// Delete
await wt.deleteSave('progress')
```

## Multiplayer

Point at your game state. Join a room. State syncs automatically.

```typescript
// Your game state
const state = { players: {} }

// Connect to Watchtower
const sync = wt.sync(state)

// Join a room
await sync.join('my-room')

// Add yourself
state.players[sync.myId] = {
  x: 0,
  y: 0,
  name: 'Player1'
}

// Move (automatically syncs to others!)
state.players[sync.myId].x += 5

// Draw everyone (others appear automatically!)
for (const [id, player] of Object.entries(state.players)) {
  drawPlayer(player.x, player.y)
}
```

No events. No message handlers. Just read and write your state.

### Creating & Joining Rooms

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

### Options

```typescript
const sync = wt.sync(state, {
  tickRate: 20,       // Updates per second (default: 20)
  interpolate: true   // Smooth remote movement (default: true)
})
```

### Properties

```typescript
sync.myId      // Your player ID
sync.roomId    // Current room, or null
sync.connected // WebSocket connected?
```

### Events (Optional)

You don't need events—just read your state. But if you want notifications:

```typescript
sync.on('join', (playerId) => console.log(playerId, 'joined'))
sync.on('leave', (playerId) => console.log(playerId, 'left'))
sync.on('connected', () => console.log('Connected'))
sync.on('disconnected', () => console.log('Disconnected'))
```

### Chat & Messages

Messages are just state:

```typescript
state.chat = [
  ...state.chat.slice(-50),  // Keep last 50
  { from: sync.myId, text: 'Hello!', ts: Date.now() }
]
```

## Full Example

```typescript
import { Watchtower } from '@watchtower-sdk/core'

const wt = new Watchtower({ gameId: 'my-game', apiKey: 'wt_...' })
const state = { players: {} }
const sync = wt.sync(state)

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
  
  // Draw everyone
  ctx.clearRect(0, 0, 800, 600)
  for (const [id, p] of Object.entries(state.players)) {
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - 10, p.y - 10, 20, 20)
  }
  
  requestAnimationFrame(loop)
}
loop()
```

## API Reference

### Watchtower

```typescript
const wt = new Watchtower({
  gameId: string,    // From dashboard
  apiKey?: string,   // From dashboard
  playerId?: string  // Auto-generated if not provided
})

wt.playerId  // Current player ID
wt.gameId    // Game ID

// Saves
await wt.save(key: string, data: any): Promise<void>
await wt.load<T>(key: string): Promise<T | null>
await wt.listSaves(): Promise<string[]>
await wt.deleteSave(key: string): Promise<void>

// Multiplayer
wt.sync(state: object, options?: SyncOptions): Sync
```

### Sync

```typescript
sync.myId: string
sync.roomId: string | null
sync.connected: boolean

await sync.join(roomId: string, options?: JoinOptions): Promise<void>
await sync.leave(): Promise<void>
await sync.create(options?: CreateOptions): Promise<string>
await sync.listRooms(): Promise<RoomListing[]>

sync.on(event: string, callback: Function): void
sync.off(event: string, callback: Function): void
```

## License

MIT
