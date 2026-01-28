# @watchtower/sdk

Simple game backend SDK - cloud saves, multiplayer rooms, automatic state sync.

## Installation

```bash
npm install @watchtower/sdk
```

## Quick Start

```typescript
import { Watchtower } from '@watchtower/sdk'

const wt = new Watchtower({
  gameId: 'my-game',
  apiKey: 'wt_live_...' // Get from dashboard
})

// Cloud saves
await wt.save('progress', { level: 5, coins: 100 })
const data = await wt.load('progress')

// Multiplayer
const room = await wt.createRoom()
console.log('Share this code:', room.code) // e.g., "ABCD"
```

## Cloud Saves

Simple key-value storage per player. Works across devices.

```typescript
// Save anything JSON-serializable
await wt.save('progress', { level: 5, coins: 100 })
await wt.save('settings', { music: true, sfx: true })
await wt.save('inventory', ['sword', 'shield', 'potion'])

// Load it back
const progress = await wt.load('progress')
const settings = await wt.load('settings')

// List all save keys
const keys = await wt.listSaves() // ['progress', 'settings', 'inventory']

// Delete a save
await wt.deleteSave('inventory')
```

## Multiplayer Rooms

Create rooms with 4-letter codes. Share with friends to play together.

```typescript
// Create a room (you become the host)
const room = await wt.createRoom()
console.log('Room code:', room.code)

// Join an existing room
const room = await wt.joinRoom('ABCD')

// Check room properties
room.isHost      // true if you're the host
room.hostId      // current host's player ID
room.playerId    // your player ID
room.playerCount // number of players
room.players     // all players' states
```

## Player State Sync

Automatically sync your player's position/state to all other players.

```typescript
// Set your player state (automatically synced at 20Hz)
room.player.set({
  x: 100,
  y: 200,
  sprite: 'running',
  health: 100
})

// State is merged, so you can update individual fields
room.player.set({ x: 150 }) // keeps y, sprite, health

// Force immediate sync
room.player.sync()

// See all players' states
room.on('players', (players) => {
  for (const [playerId, state] of Object.entries(players)) {
    if (playerId !== room.playerId) {
      // Update other player's sprite
      updateOtherPlayer(playerId, state.x, state.y, state.sprite)
    }
  }
})
```

## Game State (Host-Controlled)

Shared state for things like game phase, scores, round number. Only the host can modify it.

```typescript
// Host sets game state
if (room.isHost) {
  room.state.set({
    phase: 'lobby',
    round: 0,
    scores: {}
  })
  
  // Start the game
  room.state.set({ phase: 'playing', round: 1 })
}

// Everyone receives state updates
room.on('state', (state) => {
  if (state.phase === 'playing') {
    startGame()
  }
  if (state.phase === 'gameover') {
    showWinner(state.winner)
  }
})

// Read current state anytime
const currentState = room.state.get()
```

## Broadcast Messages

For one-off events that don't need persistent state.

```typescript
// Broadcast to all players
room.broadcast({ type: 'explosion', x: 50, y: 50 })
room.broadcast({ type: 'chat', message: 'gg!' })

// Send to specific player
room.sendTo(playerId, { type: 'private_message', text: 'hey' })

// Receive messages
room.on('message', (from, data) => {
  if (data.type === 'explosion') {
    createExplosion(data.x, data.y)
  }
  if (data.type === 'chat') {
    showChat(from, data.message)
  }
})
```

## Room Events

```typescript
// Connection established
room.on('connected', ({ playerId, room }) => {
  console.log('Connected as', playerId)
  console.log('Host is', room.hostId)
})

// Player joined
room.on('playerJoined', (playerId, playerCount) => {
  console.log(`${playerId} joined (${playerCount} players)`)
  spawnPlayer(playerId)
})

// Player left
room.on('playerLeft', (playerId, playerCount) => {
  console.log(`${playerId} left (${playerCount} players)`)
  removePlayer(playerId)
})

// Host changed (automatic migration when host leaves)
room.on('hostChanged', (newHostId) => {
  console.log('New host:', newHostId)
  if (newHostId === room.playerId) {
    console.log("I'm the host now!")
  }
})

// Disconnected
room.on('disconnected', () => {
  console.log('Lost connection')
})

// Error
room.on('error', (error) => {
  console.error('Room error:', error)
})
```

## Host Transfer

```typescript
// Host can transfer to another player
if (room.isHost) {
  room.transferHost(otherPlayerId)
}
```

## Full Example: Simple Multiplayer Game

```typescript
import { Watchtower } from '@watchtower/sdk'

const wt = new Watchtower({ gameId: 'my-game', apiKey: 'wt_...' })

// Join or create room
async function joinGame(code?: string) {
  const room = code 
    ? await wt.joinRoom(code)
    : await wt.createRoom()
  
  console.log('Room:', room.code)
  
  // Game loop - update player position
  function gameLoop() {
    room.player.set({
      x: myPlayer.x,
      y: myPlayer.y,
      animation: myPlayer.currentAnim
    })
    requestAnimationFrame(gameLoop)
  }
  gameLoop()
  
  // Render other players
  const otherPlayers: Record<string, Sprite> = {}
  
  room.on('players', (players) => {
    for (const [id, state] of Object.entries(players)) {
      if (id === room.playerId) continue
      
      // Create sprite if new player
      if (!otherPlayers[id]) {
        otherPlayers[id] = createSprite()
      }
      
      // Update position
      otherPlayers[id].x = state.x as number
      otherPlayers[id].y = state.y as number
      otherPlayers[id].play(state.animation as string)
    }
  })
  
  // Clean up when players leave
  room.on('playerLeft', (id) => {
    otherPlayers[id]?.destroy()
    delete otherPlayers[id]
  })
  
  // Handle game events
  room.on('message', (from, data: any) => {
    if (data.type === 'shoot') {
      createBullet(data.x, data.y, data.dir)
    }
  })
  
  // Game state (host manages rounds, scores)
  room.on('state', (state: any) => {
    if (state.phase === 'playing') {
      showRound(state.round)
    }
    if (state.phase === 'gameover') {
      showWinner(state.winner)
    }
  })
  
  // If we're host, start game when 2 players join
  room.on('playerJoined', (_, count) => {
    if (room.isHost && count >= 2) {
      room.state.set({ phase: 'playing', round: 1 })
    }
  })
  
  return room
}
```

## API Reference

### Watchtower

```typescript
const wt = new Watchtower(config)
```

| Config | Type | Description |
|--------|------|-------------|
| `gameId` | `string` | Your game's unique identifier |
| `apiKey` | `string` | API key from dashboard |
| `playerId` | `string?` | Custom player ID (auto-generated if not provided) |
| `apiUrl` | `string?` | Custom API URL (default: Watchtower API) |

### Room

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | 4-letter room code |
| `isHost` | `boolean` | True if you're the host |
| `hostId` | `string` | Current host's player ID |
| `playerId` | `string` | Your player ID |
| `playerCount` | `number` | Number of players |
| `players` | `PlayersState` | All players' states |
| `connected` | `boolean` | Connection status |

| Method | Description |
|--------|-------------|
| `player.set(state)` | Set your player state (auto-synced) |
| `player.get()` | Get your current player state |
| `player.sync()` | Force immediate sync |
| `state.set(state)` | Set game state (host only) |
| `state.get()` | Get current game state |
| `broadcast(data)` | Send to all players |
| `sendTo(id, data)` | Send to specific player |
| `transferHost(id)` | Transfer host (host only) |
| `disconnect()` | Leave the room |

| Event | Callback | Description |
|-------|----------|-------------|
| `connected` | `({playerId, room}) => void` | Connected to room |
| `players` | `(players) => void` | Player states updated |
| `state` | `(state) => void` | Game state updated |
| `playerJoined` | `(id, count) => void` | Player joined |
| `playerLeft` | `(id, count) => void` | Player left |
| `hostChanged` | `(newHostId) => void` | Host changed |
| `message` | `(from, data) => void` | Received broadcast |
| `disconnected` | `() => void` | Lost connection |
| `error` | `(error) => void` | Error occurred |

## License

MIT
