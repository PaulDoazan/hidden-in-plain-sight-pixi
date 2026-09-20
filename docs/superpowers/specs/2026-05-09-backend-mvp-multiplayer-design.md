# Backend MVP Multiplayer — Design

**Date:** 2026-05-09
**Author:** brainstorming session, Paul Doazan
**Status:** Draft for review

## Context

Phase 1 ([2026-05-07 design](2026-05-07-hidden-in-plain-sight-pixi-phase-1-design.md)) shipped the solo client. The NestJS server is a hello-world placeholder. The client already uses fixed world coordinates (1920×886) with per-device scaling, so it is sync-ready: the server can emit world-space state and each client renders at its own scale.

This document specifies the **first multiplayer iteration** — a deliberately minimal MVP whose only purpose is to validate the end-to-end network loop (connection → lobby → start → movement → shoot → win → cleanup) between two or more browser tabs. Larger Phase 2 ambitions (room codes, lobbies, up to 12 players, reconnection, anti-cheat) are explicitly out of scope here and will be addressed in a follow-up spec.

## Goals

1. Two or more browser tabs can join one shared game and see each other in real time.
2. The server is the sole authority for player positions, animations, hit detection and win condition.
3. The client becomes a renderer + input forwarder; no game state is computed locally beyond visual interpolation.
4. The shared protocol lives in `@hips/shared` so client and server cannot drift on event names or payload shapes.
5. The work is broken into eight committable steps, each independently demoable.

## Non-goals

- Bots (the original "hide among bots" gameplay is deferred to a later iteration).
- Room codes, multiple concurrent rooms, matchmaking.
- Player pseudonyms, accounts, persistence.
- Reconnection / resume after refresh.
- Anti-cheat beyond server authority.
- Mobile / touch.
- Audio.
- Client-side prediction or rollback (the client snaps to server state).

## Locked decisions

| Topic              | Decision                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Transport          | Socket.IO via `@nestjs/platform-socket.io`                                                                                        |
| Server authority   | Full — server owns simulation, hit detection, win condition                                                                       |
| Tick rate          | 30 Hz                                                                                                                             |
| State sync         | Full snapshot of all players each tick (no deltas)                                                                                |
| Coordinate space   | World coordinates (1920×886), shared with the client                                                                              |
| Room model         | One implicit hardcoded room, all sockets join it on connection                                                                    |
| Game start         | Manual: the host (first connected socket) clicks "Start" in the client; the server ignores `start` from non-hosts                 |
| Late join          | Allowed during `running`: the new player spawns at the standard start position and joins the live game                            |
| Replay             | After `ended`, the host can click "Replay" → state machine returns to `waiting`, players keep their socket but get fresh entities |
| Player capacity    | Soft cap: no enforcement in MVP. Acceptable for tab-based testing                                                                 |
| Disconnection      | Player removed from state immediately, broadcast to others. No grace period                                                       |
| Bullets per player | 1 (same as Phase 1)                                                                                                               |

## Architecture

### Authority and data flow

```
        ┌───────────────────────────────────────────────┐
        │                NestJS server                  │
        │  ┌─────────────────────────────────────────┐  │
        │  │  GameRoomService                        │  │
        │  │  - players: Map<socketId, PlayerState>  │  │
        │  │  - inputs:  Map<socketId, InputState>   │  │
        │  │  - status:  waiting | running | ended   │  │
        │  │  - tick():  30 Hz simulation loop       │  │
        │  └──────────────┬──────────────────────────┘  │
        │                 │ emits via                   │
        │  ┌──────────────▼──────────────────────────┐  │
        │  │  GameGateway (@WebSocketGateway)        │  │
        │  └──────────────┬──────────────────────────┘  │
        └─────────────────┼─────────────────────────────┘
                          │ Socket.IO
        ┌─────────────────▼─────────────────────────────┐
        │              Browser client(s)                │
        │  ┌─────────────────────────────────────────┐  │
        │  │  NetworkManager (singleton on Game)     │  │
        │  └──────────────┬──────────────────────────┘  │
        │                 │                             │
        │  ┌──────────────▼──────────────────────────┐  │
        │  │  GameScene                              │  │
        │  │  - reconciles entities from `state`     │  │
        │  │  - emits `input` on key/pointer change  │  │
        │  │  - emits `fire` on click                │  │
        │  └─────────────────────────────────────────┘  │
        └───────────────────────────────────────────────┘
```

The client never computes a position. It either:

- shows the last received snapshot, or
- (later, post-MVP) interpolates between the two most recent snapshots.

### Room state machine

```
            connect       host clicks Start         a player crosses arrival line
   ┌──────┐ ────────►  ┌─────────┐ ────────────►  ┌─────────┐ ──────────────────────►  ┌───────┐
   │ none │            │ waiting │                │ running │                          │ ended │
   └──────┘            └─────────┘                └─────────┘                          └───────┘
                            ▲                          │                                   │
                            └──────────────────────────┴───────── host clicks Replay ──────┘
```

- `waiting`: connections accepted, no simulation, no zombies rendered, host sees a Start button.
- `running`: tick loop active, snapshots broadcast at 30 Hz, `input`/`fire` accepted.
- `ended`: tick stopped, winnerId broadcast, host sees a Replay button.

## Protocol — `@hips/shared`

All event names, payload types and constants live in `packages/shared/src/`. Both apps import them; no string literal events exist outside this package.

### Constants (new)

```ts
// packages/shared/src/world.ts
export const WORLD_WIDTH = 1920
export const WORLD_HEIGHT = 886
export const ARRIVAL_LINE_X = WORLD_WIDTH - 60 // matches client's existing margin
export const SERVER_TICK_HZ = 30
export const WALK_SPEED = 0.5 // px / frame at 60 FPS reference, scaled to 30Hz server-side
export const RUN_SPEED = 1.2
```

The client must adopt these constants in place of the values currently in `apps/client/src/game/config/gameConfig.ts` to guarantee server/client agreement.

### Events

```ts
// packages/shared/src/events.ts

// Client → Server
export interface ClientToServerEvents {
  start: () => void // host only, valid in `waiting`
  replay: () => void // host only, valid in `ended` — resets the room to `waiting`
  input: (payload: InputPayload) => void
  fire: (payload: FirePayload) => void
}

// Server → Client
export interface ServerToClientEvents {
  'lobby-state': (payload: LobbyStatePayload) => void
  'game-started': (payload: GameStartedPayload) => void
  state: (payload: StatePayload) => void // 30 Hz
  'shot-fired': (payload: ShotFiredPayload) => void
  'player-killed': (payload: PlayerKilledPayload) => void
  'game-ended': (payload: GameEndedPayload) => void
  'player-left': (payload: PlayerLeftPayload) => void
}

export interface InputPayload {
  keys: { space: boolean; shift: boolean }
  pointer: { x: number; y: number } // world coordinates
}

export interface FirePayload {
  pointer: { x: number; y: number } // world coordinates
}

export interface PlayerState {
  id: string
  type: ZombieType
  x: number
  y: number
  animation: ZombieAnimation
  isAlive: boolean
  bulletsRemaining: number
}

export interface LobbyStatePayload {
  players: { id: string; isHost: boolean }[]
  status: 'waiting' | 'running' | 'ended'
}

export interface GameStartedPayload {
  players: PlayerState[]
  arrivalLineX: number
}

export interface StatePayload {
  players: PlayerState[]
}

export interface ShotFiredPayload {
  shooterId: string
  origin: { x: number; y: number }
  hit: { targetId: string } | null
}

export interface PlayerKilledPayload {
  id: string
}
export interface GameEndedPayload {
  winnerId: string
}
export interface PlayerLeftPayload {
  id: string
}
```

The client uses these typed event maps via Socket.IO's generic types: `io<ServerToClientEvents, ClientToServerEvents>(...)`.

### Why coordinates are converted to world space client-side before emission

The pointer arrives in screen pixels (DOM event). `GameScene` already converts to world space via `gameLayer.toLocal()` for local hit detection. We extend this: the converted world point is what gets emitted to the server in `input.pointer` and `fire.pointer`. The server only ever sees world coordinates; clients with different DPRs / viewport sizes are invisible to it.

## Server module structure

```
apps/server/src/
├── main.ts                       # bootstrap (existing)
├── app.module.ts                 # imports GameModule
├── app.controller.ts             # /health (existing)
└── game/
    ├── game.module.ts            # provides Gateway + Service
    ├── game.gateway.ts           # @WebSocketGateway, handlers
    ├── game-room.service.ts      # state, tick loop, simulation
    ├── collision.ts              # pure point-in-AABB helpers
    └── zombie-aabb.ts            # per-type AABB constants (port of client values)
```

### `GameRoomService` responsibilities

- Hold the single room state (`Map<socketId, PlayerState>`, `Map<socketId, InputState>`, `status`, `winnerId`, `hostId`).
- Apply input each tick: walk/run movement based on `keys` and `WALK_SPEED`/`RUN_SPEED`; clamp to play area; update animation.
- On `fire`: run point-in-AABB against all alive players except the shooter; pick the nearest hit; mark target `isAlive = false`, animation `die`, decrement shooter's `bulletsRemaining`. Emit `shot-fired` and (if hit) `player-killed`.
- Each tick: detect any alive player with `x >= ARRIVAL_LINE_X`; if found, transition to `ended` and emit `game-ended`.
- On disconnect: remove from both maps, reassign host if needed, broadcast `player-left`. If the host leaves during `waiting`, the next-oldest socket becomes host (broadcast updated `lobby-state`).
- Tick scheduler: a single `setInterval(33ms)` started on `running`, cleared on `ended`.

### `GameGateway` responsibilities

- Thin layer translating Socket.IO events to `GameRoomService` calls.
- On connection: register the socket, send the new client a `lobby-state` snapshot, broadcast updated `lobby-state` to others.
- On `start` from the host while `waiting`: ask `GameRoomService` to start; broadcast `game-started`.
- Holds no state of its own.

## Client integration

### New file: `apps/client/src/game/systems/NetworkManager.ts`

- Wraps `socket.io-client` with the typed event maps from `@hips/shared`.
- Owned by `Game`, alongside `InputManager`, `Layout`, etc.
- Exposes `emit(event, payload)` and `on(event, handler)`; no business logic.
- Lazy-connects on first call (so `HomeScene` doesn't open a socket).

### Changes to existing files

- **`Game.ts`**: instantiate `NetworkManager`. No other change.
- **`GameScene.ts`**:
  - On enter: connect, listen for `lobby-state`, `game-started`, `state`, `shot-fired`, `player-killed`, `game-ended`, `player-left`.
  - In `waiting` mode: render a small overlay (reuse `HelpOverlay` styling) showing player count and a Start button visible only if `isHost === true`.
  - In `running` mode: maintain `Map<id, PlayerZombie>`; on each `state`, create/update/remove `PlayerZombie` instances by id. The local player is rendered the same way as remotes — there is no "local player" entity in MVP.
  - Detect input changes (Space / Shift / pointer in world coords) and emit `input` only when the payload would differ from the last sent one.
  - On click: `emit('fire', { pointer: <world coords> })`. Visual fire effects (`fireShot`, `bloodShot`) are triggered on receipt of `shot-fired`, not on click.
  - On `game-ended`: transition to `EndScene` with `{ won: id === winnerId }`.
- **`PlayerZombie.ts`**: stop reading `InputManager`. `update(delta)` becomes a no-op (or is removed and the class becomes a pure renderable). `setState(playerState)` setter applies x/y/animation/isAlive from the server snapshot.
- **`Bullet.ts`**: the local `fire()` function is no longer called by `GameScene`. It can stay for unit tests of collision math, or be deleted; the implementation plan will decide.
- **`InputManager.ts`**: unchanged. `GameScene` reads it once per frame and forwards diffs to the server.

### What the client no longer does

- No local hit detection.
- No local position update for any zombie (local or remote).
- No local game-over detection.

This keeps the authority boundary clean and makes the MVP debuggable: any disagreement between two tabs is necessarily a server bug.

## Roadmap — eight committable steps

Each step lands in its own commit. Each step is demoable in isolation.

| #   | Title                                                                                                                                                                                                                                                                          | Done when                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | **WebSocket plumbing** — install `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io-client`. Create empty `GameGateway` with `handleConnection`/`handleDisconnect` logging. Create `NetworkManager` that connects on construction and logs.                        | Refreshing the client logs `connected` server-side, closing the tab logs `disconnected`                        |
| 2   | **Shared event types** — add `events.ts` and `world.ts` to `@hips/shared`. Type the gateway and the client socket. Replace existing `gameConfig.ts` constants with shared imports where they overlap.                                                                          | `pnpm typecheck` clean both apps; no string-literal event remains outside `@hips/shared`                       |
| 3   | **Lobby state** — `GameRoomService` tracks players. Gateway broadcasts `lobby-state` on connect/disconnect. Client overlay shows count + host-only Start button (button is wired but emits nothing yet).                                                                       | Two tabs: both see "2 joueurs", first sees Start button, second does not. Closing tab 1 promotes tab 2 to host |
| 4   | **Game start + initial spawn** — `start` handler transitions to `running`, spawns each player at staggered Y positions on the left edge, broadcasts `game-started`. Client transitions to in-game view and creates `PlayerZombie` instances from the payload. No movement yet. | Click Start in tab 1 → both tabs show the same N idle zombies at the same positions                            |
| 5   | **Movement sync** — `input` event handler stores per-socket input. Tick loop applies walk/run each frame and broadcasts `state` at 30 Hz. Client emits `input` on diff and reconciles entities from `state`.                                                                   | Hold Space in tab 1 → tab 2 sees that zombie walk forward in real time, smoothly enough to be playable         |
| 6   | **Shoot + hit** — `fire` handler runs point-in-AABB on the server. Broadcasts `shot-fired` (always) and `player-killed` (on hit). Client renders `fireShot`/`bloodShot` and `BloodSplat` from these events; sets target's animation to `die`.                                  | Tab 1 shoots tab 2's zombie → both tabs show the death animation, tab 2 stops moving                           |
| 7   | **Win + EndScene** — server detects arrival-line crossing, transitions to `ended`, broadcasts `game-ended`. Both clients transition to `EndScene` with the right won/lost outcome.                                                                                             | First zombie to cross → both tabs land on EndScene simultaneously, winner sees "Gagné", others see "Perdu"     |
| 8   | **Disconnect + replay** — disconnect during `running` removes the player and broadcasts `player-left`; client removes the entity. Replay button on `EndScene` (host only) emits `replay`, server resets the room to `waiting` and broadcasts a fresh `lobby-state`.            | Close tab 1 mid-game → tab 2 sees the zombie disappear; from EndScene, replay returns everyone to lobby        |

## Testing strategy

| Concern                           | Approach                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `collision.ts` (point-in-AABB)    | Unit tests in `apps/server` (Jest) — port the cases already covered client-side                                      |
| `GameRoomService` simulation tick | Unit tests with a fake clock: simulate inputs across N ticks, assert position progression and arrival-line detection |
| `GameRoomService` host election   | Unit tests covering connect/disconnect order                                                                         |
| Gateway wiring                    | Not unit-tested in MVP (thin pass-through). Validated end-to-end via the eight roadmap demos                         |
| Client integration                | Manual: each step in the roadmap has a concrete two-tab demo. Vitest stays focused on pure utilities                 |

## Risks and mitigations

| Risk                                                                                              | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 30 Hz snapshots produce visible jitter on the local player (input → server → snapshot round trip) | Accepted in MVP. Post-MVP: client-side prediction for the local player + server reconciliation                                         |
| `setInterval` drift                                                                               | Acceptable at 30 Hz over short games. If issues appear, swap for a self-correcting loop (`setImmediate` chain with elapsed-time delta) |
| Server tick uses 30 Hz but client constants are 60 FPS-based (`px/frame`)                         | The server scales speeds: `pxPerTick = pxPerFrame * (60 / SERVER_TICK_HZ)`. Documented in `game.constants.ts`                          |
| Two clients see different rendered scales but disagree on hit detection                           | Cannot happen: hit detection runs server-side on world coordinates only                                                                |
| Host leaves and no one is left to start                                                           | Trivially handled: with 0 players, the room sits in `waiting`. Next connection becomes host                                            |
| Late joiner during `running` with `isAlive: false` history confuses client                        | New player spawns fresh `isAlive: true`, no history replay needed                                                                      |
| Socket.IO bundle size on the client (~40 KB gz)                                                   | Acceptable. Native ws would save ~30 KB but cost room/reconnect code we'd write ourselves                                              |

## Out of scope — explicit list

To prevent scope creep during implementation, these are deferred to a later iteration:

- Bots (server-driven AI zombies for "hide among bots" gameplay)
- Room codes, multiple concurrent rooms, matchmaking
- Player pseudonyms / display names
- Reconnection after refresh
- Persistence (Redis, DB, anything)
- Anti-cheat beyond server authority
- Audio
- Mobile / touch input
- Client-side prediction / rollback / lag compensation
- Server-side anti-grief (rate limiting `fire`, `input`)

## Open questions

None. Spec is complete given the MVP minimal scope.

## Next step

Once approved, the implementation plan will be written via the `superpowers:writing-plans` skill, with one section per roadmap step.
