# Watchtower SDK "Drop and Go" Multiplayer Research

*Research Date: January 2026*

---

## Executive Summary

**The key insight:** The easiest multiplayer APIs don't ask you to restructure your game—they *wrap* your existing objects and make them sync automatically. The winning pattern is **Proxy-based reactivity** combined with a clear **"me vs. others"** mental model. Developers should be able to keep their existing player object and just call `sync(player)` to make it multiplayer.

**Time-to-First-Two-Players-Connected should be under 60 seconds**, not 3 minutes.

---

## Table of Contents

1. [Competitor Analysis](#competitor-analysis)
2. [Pattern Catalog](#pattern-catalog)
3. [Game Engine Patterns](#game-engine-patterns)
4. [The Core Problem](#the-core-problem)
5. [Recommended API](#recommended-api)
6. [Implementation Plan](#implementation-plan)
7. [Open Questions](#open-questions)

---

## Competitor Analysis

### Liveblocks — "Presence Just Works"

**What they do well:**
- Clear separation: `useMyPresence()` for your state, `useOthers()` for everyone else
- Initial presence is defined once at the provider level
- Updates are dead simple: `updateMyPresence({ cursor: { x, y } })`
- React hooks make it declarative—state drives UI naturally

**What's friction:**
- Requires React (not vanilla JS friendly)
- Must set up Provider hierarchy first
- TypeScript config file (`liveblocks.config.ts`) adds ceremony
- "Presence" vs "Storage" distinction confuses newcomers

**What we can steal:**
- The `me` vs `others` mental model is perfect
- Selector functions for `useOthers((user) => user.presence.cursor)` are elegant
- Auto-connect on provider mount is great DX

### PartyKit — "Infrastructure, Not Opinions"

**What they do well:**
- Incredibly simple server: just implement `onMessage`, `onConnect`, `onClose`
- Room-based by default—just use different room IDs
- `PartySocket` client handles reconnection
- 5 lines of code for a working broadcast server

**What's friction:**
- You build everything yourself—no presence primitives
- Need to deploy a server (even if easy)
- State management is DIY
- Examples like cursor-party require significant code

**What we can steal:**
- The room ID pattern (any string = unique room)
- Auto-reconnect in the client
- The "5 lines for a server" energy we should match on the client

**cursor-party Analysis:**
Their "one script tag" pattern for adding cursors is brilliant marketing but:
- Still ~200 lines of actual client code
- No state sync beyond cursors
- We can do better with true plug-and-play state sync

### Rune — "Separation is the Secret"

**What they do well:**
- Clean split: `logic.js` (pure functions) and `client.js` (rendering)
- State is immutable—only `actions` can change it
- `Rune.initLogic({ setup, actions })` is a beautiful API
- Predict-rollback netcode handles latency elegantly
- `onChange({ game, previousGame, action })` gives perfect render context

**What's friction:**
- Must restructure entire game to fit their model
- Logic must be deterministic (no Math.random())
- Actions-only mutation is unfamiliar to most devs
- Requires their runtime/platform—not portable

**What we can steal:**
- The `setup()` function returning initial state
- `onChange` with previous and current state for diffing
- Their insight that "separation enables sync"

### Y.js / Automerge — "CRDTs for Documents"

**What they do well:**
- Conflict-free by design—concurrent edits just merge
- Shared types (`Y.Map`, `Y.Array`) act like native JS objects
- Network agnostic—works with any transport
- Offline-first with automatic sync

**What's friction:**
- Overkill for games—CRDT overhead isn't worth it for position updates
- Learning curve for shared types
- Document model doesn't map well to "my player vs others"
- Tombstones and metadata bloat for frequently-changing data

**What we can steal:**
- The concept of "shared types that sync automatically"
- Awareness protocol for presence (cursors, selections)
- Network provider abstraction

### Supabase Realtime — "Broadcast + Presence"

**What they do well:**
- Two clear primitives: Broadcast (ephemeral) and Presence (state sync)
- Channel-based subscriptions
- Phoenix Presence under the hood (battle-tested)
- Works with existing Supabase auth

**What's friction:**
- Tied to Supabase ecosystem
- Postgres Changes feature muddles the API
- Still requires manual state management

**What we can steal:**
- The Broadcast vs Presence distinction
- "Presence" as the word for player state

### What Devs Complain About (Photon, Nakama, etc.)

Common complaints from forums and Reddit:
1. **Too much boilerplate** — "I just want to sync positions"
2. **Complex auth/matchmaking** — "I need something NOW"
3. **Expensive** — Free tiers are useless for testing with friends
4. **Documentation nightmare** — Enterprise docs, not indie-friendly
5. **Server deployment** — "I don't want to manage infrastructure"
6. **Callbacks everywhere** — Hard to reason about state flow

**The takeaway:** Devs want to skip straight to "my game but multiplayer."

---

## Pattern Catalog

### Pattern 1: The Presence Pattern (Liveblocks/Supabase)

```js
// You have "my presence" and "others' presence"
const [myPresence, updateMyPresence] = useMyPresence()
const others = useOthers()

// Update yours
updateMyPresence({ cursor: { x: 100, y: 200 } })

// Read theirs
others.map(user => user.presence.cursor)
```

**Pros:** Clear ownership, natural for cursors/selections
**Cons:** Function calls for updates feel ceremonial

### Pattern 2: The Actions Pattern (Rune/Redux)

```js
// State is read-only, actions are the only way to mutate
Rune.initLogic({
  setup: () => ({ players: {} }),
  actions: {
    move: ({ x, y }, { game, playerId }) => {
      game.players[playerId].x = x
      game.players[playerId].y = y
    }
  }
})

// Client
Rune.actions.move({ x: 100, y: 200 })
```

**Pros:** Deterministic, replayable, great for competitive games
**Cons:** Complete restructuring required, unfamiliar paradigm

### Pattern 3: The Shared Document Pattern (Y.js)

```js
// Shared types auto-sync
const ydoc = new Y.Doc()
const players = ydoc.getMap('players')

players.set(myId, { x: 0, y: 0 })
players.observe(event => {
  // Someone changed something
})
```

**Pros:** Conflict-free, offline-capable
**Cons:** CRDT overhead, document-oriented not player-oriented

### Pattern 4: The Proxy Pattern (Vue Reactivity)

```js
// Wrap an object, intercept all mutations
const state = reactive({ x: 0, y: 0 })
state.x = 100 // Automatically detected and synced
```

**Pros:** Zero ceremony, just mutate properties
**Cons:** Can't use with primitives, Proxy has edge cases

### Pattern 5: The Component Annotation Pattern (Unity/Godot)

```gdscript
# Godot: Just annotate what to sync
@export var position: Vector2
@export var health: int

# Unity: NetworkVariable<T>
public NetworkVariable<float> Health = new NetworkVariable<float>();
```

**Pros:** Declarative, IDE-friendly
**Cons:** Requires language support, not applicable to vanilla JS

---

## Game Engine Patterns

### Unity Netcode for GameObjects

```csharp
public class PlayerController : NetworkBehaviour
{
    // This variable automatically syncs to all clients
    public NetworkVariable<Vector3> Position = new NetworkVariable<Vector3>();
    
    void Update()
    {
        if (IsOwner)  // Only the owner can write
        {
            Position.Value = transform.position;
        }
        else  // Others read
        {
            transform.position = Position.Value;
        }
    }
}
```

**Key insight:** `IsOwner` check handles "me vs others" elegantly.

### Godot MultiplayerSynchronizer

```gdscript
# Just add a MultiplayerSynchronizer node and configure what to sync
# No code changes to your player script!
```

The synchronizer node watches properties by path (e.g., `".:position"`, `".:health"`).

**Key insight:** "Tag it and forget it" — no sync code in game logic.

### Bevy (Community Patterns)

Rust ECS doesn't have an official solution, but the community uses:
- Component replication (sync specific components)
- Event-based sync (serialize and send events)
- `Replicon` crate for automatic component sync

**Key insight:** ECS naturally separates state, making sync orthogonal.

---

## The Core Problem

### What does a single-player game's state look like?

```js
// Typical indie game state
const player = {
  x: 100,
  y: 200,
  velocityX: 0,
  velocityY: 0,
  health: 100,
  inventory: ['sword', 'potion'],
  animation: 'idle'
}

// Game loop
function update() {
  player.x += player.velocityX
  player.y += player.velocityY
  // ... more logic
}

function render() {
  drawSprite(player.x, player.y, player.animation)
}
```

**The problem:** This works great. Now make it multiplayer *without* changing this code.

### Minimum Change Multiplayer

The absolute minimum change would be:

```js
// Before (single-player)
const player = { x: 0, y: 0 }

// After (multiplayer) — IDEAL
const { player, others } = await wt.sync({ x: 0, y: 0 })

// Game loop unchanged!
player.x += 1

// Just add this to render:
others.forEach(p => drawSprite(p.x, p.y))
```

### How do we achieve this?

1. **JavaScript Proxy** — Wrap their player object, intercept all writes
2. **Dirty tracking** — Mark changed properties, batch sync on tick
3. **Others array** — Reactive list of remote players, auto-updates
4. **Implicit room** — Auto-join a room based on URL or generate one

### Handling "My Player" vs "Other Players"

The cleanest model:
- **Your player:** A Proxy-wrapped object you mutate directly
- **Others:** A read-only array that updates automatically
- **No mixing:** Don't put yourself in the `others` array

```js
// Clear ownership
const { me, others } = await sync(initialState)

me.x = 100  // You control this
others[0].x = ???  // Read-only, comes from network
```

---

## Recommended API

### The "Holy Shit That Was Easy" API

```js
import { sync } from '@watchtower/sdk'

// Your existing player object — KEEP IT
const player = { x: 0, y: 0, name: 'Player1', color: '#ff0000' }

// One line. That's it.
const { others, room } = await sync(player)

// Your game loop — UNCHANGED
function gameLoop() {
  // Move (automatically syncs to others)
  if (keys.left) player.x -= 5
  if (keys.right) player.x += 5
  
  // Draw yourself
  draw(player.x, player.y, player.color)
  
  // Draw others (automatically updated)
  for (const other of others) {
    draw(other.x, other.y, other.color)
  }
  
  requestAnimationFrame(gameLoop)
}
```

### Full API Surface

```typescript
interface SyncResult<T> {
  /** Others' states, automatically updating */
  others: readonly T[]
  
  /** Room code for sharing */
  room: string
  
  /** Your player ID */
  id: string
  
  /** Number of players (including you) */
  count: number
  
  /** Network latency in ms */
  latency: number
  
  /** Connection state */
  connected: boolean
  
  /** Leave the room */
  leave(): Promise<void>
  
  /** Send a one-off event */
  broadcast(event: unknown): void
  
  /** Listen to events */
  on(event: 'join' | 'leave' | 'message', cb: Function): void
}

interface SyncOptions {
  /** Room code (auto-generated if not provided) */
  room?: string
  
  /** Sync rate in Hz (default: 20) */
  tickRate?: number
  
  /** Smoothing mode for others (default: 'lerp') */
  smoothing?: 'none' | 'lerp' | 'interpolate'
  
  /** Lerp factor 0-1 (default: 0.15) */
  lerpFactor?: number
}

/** Main sync function */
function sync<T extends object>(
  state: T,
  options?: SyncOptions
): Promise<SyncResult<T>>
```

### Example: Adding Multiplayer to Existing Game

**Before (single-player):**
```js
const player = { x: 100, y: 100, health: 100 }

function update() {
  if (keys.w) player.y -= 5
  if (keys.s) player.y += 5
  if (keys.a) player.x -= 5
  if (keys.d) player.x += 5
}

function render() {
  ctx.fillRect(player.x, player.y, 20, 20)
}
```

**After (multiplayer) — 3 lines changed:**
```js
import { sync } from '@watchtower/sdk'

const player = { x: 100, y: 100, health: 100 }
const { others } = await sync(player)  // <-- Line 1

function update() {
  if (keys.w) player.y -= 5
  if (keys.s) player.y += 5
  if (keys.a) player.x -= 5
  if (keys.d) player.x += 5
}

function render() {
  ctx.fillRect(player.x, player.y, 20, 20)
  
  // <-- Lines 2-3
  for (const other of others) {
    ctx.fillRect(other.x, other.y, 20, 20)
  }
}
```

### Joining a Specific Room

```js
// Host creates room
const { room } = await sync(player)
console.log(`Share this code: ${room}`) // "XKCD42"

// Friend joins
const { others } = await sync(player, { room: 'XKCD42' })
```

### React Integration

```jsx
import { useSync } from '@watchtower/react'

function Game() {
  const { me, others, room } = useSync({ x: 0, y: 0 })
  
  useEffect(() => {
    const handle = (e) => {
      me.x = e.clientX
      me.y = e.clientY
    }
    window.addEventListener('mousemove', handle)
    return () => window.removeEventListener('mousemove', handle)
  }, [me])
  
  return (
    <div>
      <div style={{ position: 'absolute', left: me.x, top: me.y }}>Me</div>
      {others.map(other => (
        <div key={other.id} style={{ position: 'absolute', left: other.x, top: other.y }}>
          Other
        </div>
      ))}
    </div>
  )
}
```

---

## Implementation Plan

### Phase 1: Core Proxy Sync (1 week)

1. **Proxy wrapper function**
   - Deep proxy that intercepts all property sets
   - Dirty tracking for changed properties
   - Handle nested objects

2. **Simplified sync() function**
   - Auto-generate room code if not provided
   - Connect WebSocket
   - Return `{ others, room, id, ... }`

3. **Others array**
   - Reactive array that updates when remote state arrives
   - Apply lerp/interpolation smoothing
   - Remove players on disconnect

**Deliverable:** Working `sync(player)` that returns `{ others }`.

### Phase 2: DX Polish (3 days)

1. **Auto-reconnect** — Already implemented, verify it works
2. **Latency display** — Already implemented
3. **Room codes** — Shorter, pronounceable codes (e.g., "HAPPY-TIGER")
4. **Error messages** — Clear, actionable errors

**Deliverable:** Production-ready sync API.

### Phase 3: React Bindings (2 days)

1. **useSync hook** — Wraps sync() with proper cleanup
2. **SyncProvider** — Optional context for room sharing
3. **SSR handling** — Ensure no WebSocket on server

**Deliverable:** `@watchtower/react` package.

### Phase 4: Documentation & Examples (2 days)

1. **"5 Minute Multiplayer" tutorial**
2. **Example: Pong in 50 lines**
3. **Example: Cursor party clone**
4. **Example: Simple shooter**

**Deliverable:** Docs that make devs say "holy shit."

### Total Estimate: ~2 weeks

---

## Open Questions

### 1. What about the existing `wt.sync()` API?

The current API (`state = { players: {} }`, `sync.myId`) is more explicit but requires restructuring. Options:
- **A)** Replace it entirely with the new `sync(player)` API
- **B)** Keep both, document the new one as "Quick Start"
- **C)** Deprecate old, migrate to new

**Recommendation:** Option B initially, move to A once validated.

### 2. How do we handle initial state for late joiners?

When player 3 joins, they need to see players 1 and 2:
- Server stores last known state per player
- On connect, server sends full state dump
- Late joiner's `others` populates immediately

This is already handled in current implementation—verify it works.

### 3. What about shared game state (not player state)?

Current API has `room.state.set()` for host-controlled state. For the new API:
- Could expose `sync.shared` for shared state
- Or keep it separate: `sync()` for player, different API for shared

**Recommendation:** Start with player-only sync, add shared state later if needed.

### 4. Proxy limitations

- Can't proxy primitives (`let x = 0`)
- Some edge cases with arrays
- Prototype chain issues

**Mitigation:** Require an object (not primitive), document limitations clearly.

### 5. What if they don't want all properties synced?

Some properties shouldn't sync (local animation state, etc.):

```js
const player = {
  x: 0,           // Sync this
  y: 0,           // Sync this
  _localTime: 0   // Don't sync (underscore prefix?)
}
```

**Options:**
- Convention: underscore prefix = local only
- Explicit: `sync(player, { only: ['x', 'y'] })`
- Explicit: `sync(player, { except: ['_localTime'] })`

**Recommendation:** Start with "sync everything," add `only`/`except` if needed.

### 6. Bandwidth optimization

Syncing full state every tick is wasteful. Ideas:
- Delta compression (only send changed properties)
- Quantization (reduce precision for positions)
- Variable tick rate (slower for less important data)

**Recommendation:** Implement delta compression in Phase 1, others later.

### 7. What's the competitive advantage?

Liveblocks, PartyKit, Rune all exist. Why Watchtower?

1. **Simpler API** — One function, not a framework
2. **Game-focused** — Built for games, not docs
3. **Indie-friendly** — Generous free tier (needed)
4. **No restructuring** — Keep your existing code

---

## Summary

The research points to a clear winner: **Proxy-based "wrap your object" sync** with a **"me vs others" mental model**. This is simpler than Liveblocks (no React required), more opinionated than PartyKit (batteries included), and doesn't require restructuring like Rune.

The API should be:

```js
const { others } = await sync(myPlayer)
```

That's it. One line to make a single-player game multiplayer.

---

*Research compiled from: Liveblocks docs, PartyKit docs, Rune SDK docs, Y.js docs, Godot networking docs, Unity Netcode docs, Supabase Realtime, Vue reactivity deep dive, MDN Proxy reference, and various GitHub examples.*
