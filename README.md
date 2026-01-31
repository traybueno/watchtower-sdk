# @watchtower-sdk/core

Multiplayer infrastructure in one line. Your architecture.

## Installation

```bash
npm install @watchtower-sdk/core
```

## Quick Start

```typescript
import { connect } from '@watchtower-sdk/core'

// Connect to a room (creates it if it doesn't exist)
const room = await connect('my-room')

// Send to everyone
room.broadcast({ x: 100, y: 200, action: 'move' })

// Receive messages
room.on('message', (from, data, meta) => {
  console.log(`Player ${from}:`, data)
  console.log('Server time:', meta.serverTime)
})

// Room info
console.log('Players:', room.players)
console.log('Am I host?', room.isHost)
console.log('Share code:', room.code)
```

## What You Get

| Feature | Description |
|---------|-------------|
| **Connection** | WebSocket to room, auto-reconnect |
| **Rooms** | Create/join with codes, share URLs |
| **Messaging** | Broadcast to all, or send to one |
| **Player tracking** | Who's in, who's host |
| **Timestamps** | Server time + tick on every message |
| **Persistence** | Save/load per-player data |

## What You Build

| Feature | Description |
|---------|-------------|
| **State sync** | You decide how to sync state |
| **Interpolation** | You smooth movement if needed |
| **Game logic** | You control everything |

---

## API Reference

### `connect(roomId?, options?)`

Connect to a room. Creates it if it doesn't exist.

```typescript
// Join or create room
const room = await connect('ABCD')

// Auto-generate room code
const room = await connect()
console.log('Share:', room.code)  // e.g., "X7K2M9"

// With options
const room = await connect('ABCD', {
  name: 'Player1',
  meta: { avatar: 'knight', color: '#ff0000' }
})
```

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `gameId` | string | Your game ID (defaults to hostname) |
| `playerId` | string | Your player ID (auto-generated) |
| `name` | string | Display name |
| `meta` | object | Custom metadata (avatar, color, etc) |

---

### Messaging

#### `room.broadcast(data)`

Send data to all players in the room.

```typescript
room.broadcast({ type: 'move', x: 100, y: 200 })
room.broadcast({ type: 'chat', text: 'Hello!' })
room.broadcast({ type: 'shoot', angle: 45 })
```

#### `room.send(playerId, data)`

Send data to a specific player.

```typescript
room.send('player123', { type: 'private', text: 'Hey!' })
```

#### `room.on('message', callback)`

Receive messages from other players.

```typescript
room.on('message', (from, data, meta) => {
  // from: player ID who sent it
  // data: whatever they sent
  // meta: { serverTime, tick }
  
  if (data.type === 'move') {
    updatePlayer(from, data.x, data.y)
  }
})
```

---

### Room Info

```typescript
room.code        // Room code for sharing (e.g., "ABCD")
room.playerId    // Your player ID
room.players     // Array of { id, name, meta, joinedAt }
room.playerCount // Number of players
room.isHost      // Are you the host?
room.hostId      // Current host's player ID
room.connected   // WebSocket connected?
```

---

### Events

```typescript
room.on('join', (player) => {
  console.log(`${player.name || player.id} joined!`)
})

room.on('leave', (player) => {
  console.log(`${player.id} left`)
})

room.on('connected', () => {
  console.log('Connected to room')
})

room.on('disconnected', () => {
  console.log('Disconnected (will auto-reconnect)')
})

room.on('error', (error) => {
  console.error('Error:', error)
})
```

---

### Persistence

Save and load data per-player. Survives sessions.

```typescript
// Save
await room.save('progress', { level: 5, coins: 100 })

// Load
const progress = await room.load('progress')

// Delete
await room.delete('progress')
```

---

### Lifecycle

```typescript
// Leave the room
room.leave()
```

---

## Patterns

### Cursor Party

```typescript
const room = await connect('cursors')

document.onmousemove = (e) => {
  room.broadcast({ x: e.clientX, y: e.clientY })
}

const cursors = {}

room.on('message', (from, data) => {
  cursors[from] = data
})

room.on('leave', (player) => {
  delete cursors[player.id]
})

function draw() {
  ctx.clearRect(0, 0, width, height)
  for (const [id, pos] of Object.entries(cursors)) {
    ctx.fillRect(pos.x - 5, pos.y - 5, 10, 10)
  }
  requestAnimationFrame(draw)
}
draw()
```

### Turn-Based Game

```typescript
const room = await connect('chess')

let gameState = { board: initialBoard, turn: null }

// Host controls game state
if (room.isHost) {
  gameState.turn = room.playerId
  room.broadcast({ type: 'state', ...gameState })
}

room.on('message', (from, data) => {
  if (data.type === 'state') {
    gameState = data
    render()
  }
  
  if (data.type === 'move' && room.isHost) {
    // Validate and apply move
    gameState.board = applyMove(gameState.board, data.from, data.to)
    gameState.turn = getNextPlayer()
    room.broadcast({ type: 'state', ...gameState })
  }
})

function makeMove(from, to) {
  room.broadcast({ type: 'move', from, to })
}
```

### Shooter with Events

```typescript
const room = await connect('shooter')

const players = {}

room.on('message', (from, data, meta) => {
  switch (data.type) {
    case 'pos':
      players[from] = { ...players[from], ...data, lastUpdate: meta.serverTime }
      break
    case 'shoot':
      spawnBullet(from, data.angle)
      break
    case 'hit':
      if (data.target === room.playerId) {
        myHealth -= data.damage
      }
      break
  }
})

// Send position updates
setInterval(() => {
  room.broadcast({ type: 'pos', x: player.x, y: player.y })
}, 50)

function shoot(angle) {
  room.broadcast({ type: 'shoot', angle })
}
```

---

## Smoothing Movement

The SDK doesn't smooth movement — you control that. Here's a simple approach:

```typescript
const players = {}
const LERP = 0.15

room.on('message', (from, data) => {
  if (!players[from]) players[from] = { x: data.x, y: data.y }
  players[from].targetX = data.x
  players[from].targetY = data.y
})

function update() {
  for (const p of Object.values(players)) {
    p.x += (p.targetX - p.x) * LERP
    p.y += (p.targetY - p.y) * LERP
  }
  requestAnimationFrame(update)
}
update()
```

---

## License

MIT
