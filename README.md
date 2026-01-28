# @watchtower/sdk

> Simple game backend SDK — cloud saves, multiplayer rooms, and more.

**No servers. No DevOps. Just call the API.**

## Installation

```bash
npm install @watchtower/sdk
```

## Quick Start

```typescript
import { Watchtower } from '@watchtower/sdk'

// Initialize with your game ID
const wt = new Watchtower({ gameId: 'my-awesome-game' })

// Cloud saves - that's it!
await wt.save('progress', { level: 5, coins: 100 })
const data = await wt.load('progress')

// Multiplayer - also that simple
const room = await wt.createRoom()
console.log('Share this code:', room.code)  // e.g., "ABCD"

room.on('playerJoined', (playerId) => {
  console.log('Player joined:', playerId)
})

room.on('message', (from, data) => {
  console.log('Received:', data)
})

room.broadcast({ x: player.x, y: player.y })
```

## Cloud Saves

Save any JSON data per player. Data persists across sessions and devices.

```typescript
// Save data
await wt.save('progress', { level: 5, coins: 100 })
await wt.save('settings', { music: true, difficulty: 'hard' })

// Load data
const progress = await wt.load('progress')
// => { level: 5, coins: 100 }

// List all saves
const keys = await wt.listSaves()
// => ['progress', 'settings']

// Delete a save
await wt.deleteSave('progress')
```

## Multiplayer Rooms

Create or join rooms with simple 4-letter codes. Real-time WebSocket messaging.

### Create a Room

```typescript
const room = await wt.createRoom()
console.log('Room code:', room.code)  // Share this with friends!
```

### Join a Room

```typescript
const room = await wt.joinRoom('ABCD')
```

### Room Events

```typescript
// Someone joined
room.on('playerJoined', (playerId, playerCount) => {
  console.log(`${playerId} joined! ${playerCount} players now.`)
})

// Someone left
room.on('playerLeft', (playerId, playerCount) => {
  console.log(`${playerId} left. ${playerCount} players remaining.`)
})

// Received a message
room.on('message', (from, data) => {
  console.log(`${from} says:`, data)
})

// Connection events
room.on('connected', (info) => {
  console.log('Connected as:', info.playerId)
})

room.on('disconnected', () => {
  console.log('Lost connection')
})
```

### Sending Messages

```typescript
// Broadcast to everyone (except yourself)
room.broadcast({ type: 'move', x: 100, y: 200 })

// Send to a specific player
room.sendTo('player_abc123', { type: 'private', message: 'Hello!' })
```

### Room Management

```typescript
// Check connection status
if (room.connected) {
  room.broadcast({ status: 'ready' })
}

// Get room info without joining
const info = await wt.getRoomInfo('ABCD')
console.log(info.playerCount, 'players in room')

// Disconnect
room.disconnect()
```

## Player IDs

Each player gets a unique ID, stored in localStorage (browser) or generated fresh (Node.js).

```typescript
const wt = new Watchtower({ gameId: 'my-game' })
console.log(wt.playerId)  // e.g., "player_x7k9m2n4p"

// Or provide your own
const wt = new Watchtower({
  gameId: 'my-game',
  playerId: 'custom_player_id'
})
```

## Configuration

```typescript
const wt = new Watchtower({
  gameId: 'my-game',           // Required: your game's identifier
  playerId: 'player_123',      // Optional: custom player ID
  apiUrl: 'https://...',       // Optional: custom API URL
  apiKey: 'wt_...'             // Optional: API key (for authenticated games)
})
```

## TypeScript

Full TypeScript support with exported types:

```typescript
import { Watchtower, Room, RoomInfo, RoomEventMap } from '@watchtower/sdk'
```

## Works Everywhere

- ✅ Browser (vanilla JS, React, Vue, etc.)
- ✅ Node.js
- ✅ Electron
- ✅ React Native (with WebSocket polyfill)

## Example: Simple Multiplayer Game

```typescript
import { Watchtower } from '@watchtower/sdk'

const wt = new Watchtower({ gameId: 'my-game' })

async function startGame() {
  // Create or join room
  const code = prompt('Enter room code (or leave empty to create):')
  const room = code 
    ? await wt.joinRoom(code)
    : await wt.createRoom()
  
  if (!code) {
    alert(`Share this code: ${room.code}`)
  }

  // Handle other players
  const players = new Map()
  
  room.on('message', (from, data) => {
    if (data.type === 'position') {
      players.set(from, { x: data.x, y: data.y })
    }
  })

  room.on('playerLeft', (playerId) => {
    players.delete(playerId)
  })

  // Game loop - broadcast your position
  setInterval(() => {
    room.broadcast({
      type: 'position',
      x: myPlayer.x,
      y: myPlayer.y
    })
  }, 50) // 20 updates per second
}

startGame()
```

## Links

- **Website:** https://watchtower.host
- **API Docs:** https://watchtower.host/docs
- **GitHub:** https://github.com/watchtower-host/sdk

## License

MIT
