# Backend MVP Multiplayer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first multiplayer iteration: two or more browser tabs join one server-authoritative room over Socket.IO, see each other walk and shoot in real time, and a winner is declared when someone crosses the arrival line.

**Architecture:** NestJS + `@nestjs/platform-socket.io` gateway, single hardcoded room, server-authoritative simulation at 30 Hz, full per-tick snapshot sync, world-space coordinates shared with the client via `@hips/shared`. The client becomes a thin renderer + input forwarder.

**Tech Stack:** NestJS 10, Socket.IO 4, socket.io-client 4, PixiJS 8, TypeScript strict, Jest (server), Vitest (client).

**Spec:** [docs/superpowers/specs/2026-05-09-backend-mvp-multiplayer-design.md](../specs/2026-05-09-backend-mvp-multiplayer-design.md)

---

## File map

### Created

| Path                                             | Responsibility                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `packages/shared/src/world.ts`                   | World constants (size, arrival line, tick rate, speeds) shared by both apps |
| `packages/shared/src/events.ts`                  | Socket.IO event maps + payload types (the wire protocol)                    |
| `apps/server/src/game/game.module.ts`            | NestJS module for the gateway + service                                     |
| `apps/server/src/game/game.gateway.ts`           | Socket.IO gateway (thin pass-through to the service)                        |
| `apps/server/src/game/game-room.service.ts`      | The single room: state, tick loop, simulation, hit detection                |
| `apps/server/src/game/collision.ts`              | Pure point-in-AABB and find-nearest helpers                                 |
| `apps/server/src/game/zombie-aabb.ts`            | Per-type AABB constants (port of `ZOMBIE_BODY_BOX`)                         |
| `apps/server/src/game/collision.spec.ts`         | Unit tests for `collision.ts`                                               |
| `apps/server/src/game/game-room.service.spec.ts` | Unit tests for the room (host election, tick movement, hit, win)            |
| `apps/client/src/systems/NetworkManager.ts`      | Singleton wrapping `socket.io-client` with the typed event maps             |
| `apps/client/src/ui/WaitingRoomOverlay.ts`       | Lobby overlay shown while `status === 'waiting'`                            |

### Modified

| Path                                       | Change                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `apps/server/package.json`                 | Add `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`                                                |
| `apps/server/src/main.ts`                  | Enable CORS for the client origin                                                                                  |
| `apps/server/src/app.module.ts`            | Import `GameModule`                                                                                                |
| `apps/client/package.json`                 | Add `socket.io-client`                                                                                             |
| `apps/client/src/app/Game.ts`              | Instantiate `NetworkManager`                                                                                       |
| `apps/client/src/scenes/GameScene.ts`      | Replace local simulation with server-driven entities; add waiting overlay; emit input/fire; react to server events |
| `apps/client/src/scenes/EndScene.ts`       | Replay button emits `replay` (host only) and waits for the server to transition the room                           |
| `apps/client/src/entities/PlayerZombie.ts` | Drop input reading; add `setState(state)` to apply server snapshots                                                |
| `apps/client/src/config/gameConfig.ts`     | Re-export shared world constants instead of redefining them                                                        |
| `packages/shared/src/index.ts`             | Re-export `world.ts` and `events.ts`                                                                               |

---

## Task 1: WebSocket plumbing

Stand up the Socket.IO transport. No protocol yet — just verify a browser tab can connect to the NestJS server and we see it both ways.

**Files:**

- Modify: `apps/server/package.json`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/app.module.ts`
- Create: `apps/server/src/game/game.module.ts`
- Create: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/client/package.json`
- Create: `apps/client/src/systems/NetworkManager.ts`
- Modify: `apps/client/src/app/Game.ts`

- [ ] **Step 1.1: Install server dependencies**

Run:

```bash
pnpm --filter server add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

Expected: package.json updated, lockfile regenerated, no errors.

- [ ] **Step 1.2: Install client dependency**

Run:

```bash
pnpm --filter client add socket.io-client
```

Expected: client package.json gains `socket.io-client` (^4.x).

- [ ] **Step 1.3: Enable CORS on the Nest app**

Replace the contents of `apps/server/src/main.ts` with:

```ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: { origin: 'http://localhost:5173', credentials: true },
  })
  await app.listen(3000)
}
void bootstrap()
```

Why: Socket.IO upgrades a CORS-checked HTTP request, the Vite dev server runs on 5173, the Nest server on 3000. Without explicit CORS origin the handshake fails.

- [ ] **Step 1.4: Create the GameGateway with connection logging**

Create `apps/server/src/game/game.gateway.ts`:

```ts
import { Logger } from '@nestjs/common'
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets'
import type { Socket } from 'socket.io'

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  handleConnection(socket: Socket): void {
    this.logger.log(`connected: ${socket.id}`)
  }

  handleDisconnect(socket: Socket): void {
    this.logger.log(`disconnected: ${socket.id}`)
  }
}
```

- [ ] **Step 1.5: Create the GameModule**

Create `apps/server/src/game/game.module.ts`:

```ts
import { Module } from '@nestjs/common'

import { GameGateway } from './game.gateway'

@Module({ providers: [GameGateway] })
export class GameModule {}
```

- [ ] **Step 1.6: Register the GameModule on the app**

Replace `apps/server/src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common'

import { AppController } from './app.controller'
import { GameModule } from './game/game.module'

@Module({
  imports: [GameModule],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 1.7: Create the NetworkManager**

Create `apps/client/src/systems/NetworkManager.ts`:

```ts
import { io, type Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

export class NetworkManager {
  private socket: Socket | null = null

  connect(): void {
    if (this.socket) return
    this.socket = io(SERVER_URL, { withCredentials: true })
    this.socket.on('connect', () => {
      console.log('[net] connected', this.socket?.id)
    })
    this.socket.on('disconnect', (reason) => {
      console.log('[net] disconnected', reason)
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }
}
```

Why lazy connect: HomeScene must not open a socket — only the GameScene flow does, and even then we'll trigger it explicitly in Task 3.

- [ ] **Step 1.8: Wire NetworkManager onto Game**

Modify `apps/client/src/app/Game.ts`. Add the import and field.

Add after the `Layout` import:

```ts
import { NetworkManager } from '../systems/NetworkManager'
```

Add the field next to the others:

```ts
  readonly net: NetworkManager
```

Inside the constructor, after `this.layout.recompute(window)`, add:

```ts
this.net = new NetworkManager()
```

(Order: it must exist before any scene uses it. Construction is cheap; it does not connect yet.)

- [ ] **Step 1.9: Manual smoke test**

Run two terminals:

```bash
pnpm dev:server
pnpm dev:client
```

In a third terminal, open a Node REPL and trigger a connection (or temporarily call `game.net.connect()` from the browser DevTools console after the page loads). Expected:

- Server log: `connected: <id>`
- Client console: `[net] connected <id>`
- Closing the tab: server logs `disconnected: <id>`, client logs `[net] disconnected ...`

Do **not** add a permanent `connect()` call yet; Task 3 wires it via `GameScene.onEnter`.

- [ ] **Step 1.10: Commit**

```bash
git add apps/server/package.json apps/server/src/main.ts apps/server/src/app.module.ts apps/server/src/game/ apps/client/package.json apps/client/src/systems/NetworkManager.ts apps/client/src/app/Game.ts pnpm-lock.yaml
git commit -m "feat(net): add Socket.IO gateway + client NetworkManager scaffold"
```

---

## Task 2: Shared event types

Define the wire protocol once, in `@hips/shared`. After this task no string-literal event name exists outside the package, and both apps import the same constants.

**Files:**

- Create: `packages/shared/src/world.ts`
- Create: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/client/src/config/gameConfig.ts`

- [ ] **Step 2.1: Create shared world constants**

Create `packages/shared/src/world.ts`:

```ts
export const WORLD_WIDTH = 1920
export const WORLD_HEIGHT = 886

// Margin from the right edge to the dashed arrival line, in world units.
// Matches the existing client value (apps/client/src/config/gameConfig.ts).
export const ARRIVAL_LINE_MARGIN = 80
export const ARRIVAL_LINE_X = WORLD_WIDTH - ARRIVAL_LINE_MARGIN

export const SERVER_TICK_HZ = 30

// Movement speeds are expressed in px/frame at a 60 FPS reference, matching
// the existing client tuning. The server scales them to its tick rate via
// `pxPerTick = pxPerFrame * (60 / SERVER_TICK_HZ)`.
export const WALK_SPEED = 0.5
export const RUN_SPEED = 1.2

// Spawn positions: every player spawns somewhere in this band on the x axis.
export const SPAWN_BAND_X = 30
export const SPAWN_BAND_WIDTH = 40
```

- [ ] **Step 2.2: Create shared event types**

Create `packages/shared/src/events.ts`:

```ts
import type { ZombieAnimation, ZombieType } from './index'

export interface PlayerState {
  id: string
  type: ZombieType
  x: number
  y: number
  animation: ZombieAnimation
  isAlive: boolean
  bulletsRemaining: number
}

export type RoomStatus = 'waiting' | 'running' | 'ended'

export interface InputPayload {
  keys: { space: boolean; shift: boolean }
  pointer: { x: number; y: number } // world coordinates
}

export interface FirePayload {
  pointer: { x: number; y: number } // world coordinates
}

export interface LobbyStatePayload {
  players: { id: string; isHost: boolean }[]
  status: RoomStatus
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

// Client → Server
export interface ClientToServerEvents {
  start: () => void // host only, valid in `waiting`
  replay: () => void // host only, valid in `ended` — resets to `waiting`
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
```

- [ ] **Step 2.3: Re-export from the shared barrel**

Modify `packages/shared/src/index.ts`. Append at the end:

```ts
export * from './world'
export * from './events'
```

- [ ] **Step 2.4: Replace overlapping client constants with shared imports**

Modify `apps/client/src/config/gameConfig.ts` to remove duplicates. Replace the entire file with:

```ts
import {
  ARRIVAL_LINE_MARGIN as SHARED_ARRIVAL_LINE_MARGIN,
  RUN_SPEED,
  WALK_SPEED,
  WORLD_HEIGHT as SHARED_WORLD_HEIGHT,
  WORLD_WIDTH as SHARED_WORLD_WIDTH,
  type GameConfig,
} from '@hips/shared'

// Re-export under the existing names so client call sites don't change.
export const WORLD_WIDTH = SHARED_WORLD_WIDTH
export const WORLD_HEIGHT = SHARED_WORLD_HEIGHT
export const ARRIVAL_LINE_MARGIN = SHARED_ARRIVAL_LINE_MARGIN

export const defaultGameConfig: GameConfig = {
  numBots: 20,
  walkSpeed: WALK_SPEED,
  runSpeed: RUN_SPEED,
  bulletsPerPlayer: 1,
  playAreaRatio: WORLD_WIDTH / WORLD_HEIGHT,
}

// Debug: render each zombie's collision AABB as a translucent blue rectangle.
export const DEBUG_HITBOXES = false

export const CROSSHAIR_RADIUS = 25
// Vertical offset where the dashed arrival line starts (top edge in world units).
export const ARRIVAL_LINE_TOP_Y = 250
export const CROSSHAIR_COLOR = 0xfff700
```

Why: post-refactor, `WORLD_WIDTH`/`WORLD_HEIGHT`/`WALK_SPEED`/`RUN_SPEED`/`ARRIVAL_LINE_MARGIN` come from `@hips/shared`. The client keeps `defaultGameConfig`, `CROSSHAIR_RADIUS`, `DEBUG_HITBOXES`, `ARRIVAL_LINE_TOP_Y`, `CROSSHAIR_COLOR` because they are client-only.

- [ ] **Step 2.5: Type the gateway and the client socket**

Modify `apps/server/src/game/game.gateway.ts`. Replace the imports and class signature:

```ts
import { Logger } from '@nestjs/common'
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets'
import type { ClientToServerEvents, ServerToClientEvents } from '@hips/shared'
import type { Server, Socket } from 'socket.io'

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type AppServer = Server<ClientToServerEvents, ServerToClientEvents>

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  handleConnection(socket: AppSocket): void {
    this.logger.log(`connected: ${socket.id}`)
  }

  handleDisconnect(socket: AppSocket): void {
    this.logger.log(`disconnected: ${socket.id}`)
  }
}
```

The `AppServer` alias will be used in Task 3 for broadcasts. (TypeScript allows declaring the alias even before it's used; the unused-vars rule is configured to allow `AppServer` since it appears in same-file scope. If the lint rule complains, leave the alias commented out and re-add in Task 3.)

Note: `apps/server` must be able to import from `@hips/shared`. Verify `apps/server/package.json` already lists `"@hips/shared": "workspace:*"` (it does, per the existing setup).

Modify `apps/client/src/systems/NetworkManager.ts` to type the socket:

```ts
import type { ClientToServerEvents, ServerToClientEvents } from '@hips/shared'
import { io, type Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export class NetworkManager {
  private socket: AppSocket | null = null

  connect(): void {
    if (this.socket) return
    this.socket = io(SERVER_URL, { withCredentials: true })
    this.socket.on('connect', () => {
      console.log('[net] connected', this.socket?.id)
    })
    this.socket.on('disconnect', (reason) => {
      console.log('[net] disconnected', reason)
    })
  }

  get raw(): AppSocket | null {
    return this.socket
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }
}
```

- [ ] **Step 2.6: Run typecheck on both apps**

Run:

```bash
pnpm -r typecheck
```

Expected: PASS for client, server, shared. If any error appears about `ZombieAnimation`/`ZombieType` not found in `events.ts`, verify the relative import in `events.ts` (`from './index'`).

- [ ] **Step 2.7: Commit**

```bash
git add packages/shared/ apps/client/src/config/gameConfig.ts apps/client/src/systems/NetworkManager.ts apps/server/src/game/game.gateway.ts
git commit -m "feat(shared): add socket events + world constants protocol"
```

---

## Task 3: Lobby state

The server tracks connected sockets in a `GameRoomService`, broadcasts a `lobby-state` event on every change, and elects the oldest socket as host. The client renders a waiting-room overlay before any game starts.

**Files:**

- Modify: `apps/server/package.json` (ts-jest setup)
- Create: `apps/server/src/game/game-room.service.ts`
- Create: `apps/server/src/game/game-room.service.spec.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/server/src/game/game.module.ts`
- Create: `apps/client/src/ui/WaitingRoomOverlay.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

- [ ] **Step 3.0: Set up ts-jest on the server**

The current Jest config has no TypeScript transform, so adding a `.spec.ts` file would fail to parse. Wire ts-jest now, before the first test is written.

Run:

```bash
pnpm --filter server add -D ts-jest @types/jest
```

Modify `apps/server/package.json`. Replace the existing `jest` block:

```json
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "testEnvironment": "node",
    "transform": {
      "^.+\\.ts$": ["ts-jest", { "tsconfig": "<rootDir>/../tsconfig.json" }]
    },
    "moduleNameMapper": {
      "^@hips/shared$": "<rootDir>/../../../packages/shared/src/index.ts"
    }
  }
```

Why `moduleNameMapper`: the server's `@hips/shared` workspace dep points at `src/index.ts` directly (per the package's `main`/`exports`), and Jest needs this mapping spelled out so test files can `import from '@hips/shared'`. `<rootDir>` is `apps/server/src`, so the relative path goes up to repo root and into `packages/shared`.

Run a smoke test to verify the transform works:

```bash
pnpm --filter server test
```

Expected: `No tests found, exiting with code 0` (because of `--passWithNoTests`). Crucially: no parse error.

- [ ] **Step 3.1: Write the failing host-election test**

Create `apps/server/src/game/game-room.service.spec.ts`:

```ts
import { GameRoomService } from './game-room.service'

describe('GameRoomService — lobby', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
  })

  it('makes the first connecting socket the host', () => {
    room.addPlayer('a')
    expect(room.snapshotLobby()).toEqual({
      players: [{ id: 'a', isHost: true }],
      status: 'waiting',
    })
  })

  it('keeps the oldest connection as host when others join', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    expect(room.snapshotLobby().players).toEqual([
      { id: 'a', isHost: true },
      { id: 'b', isHost: false },
    ])
  })

  it('promotes the next-oldest socket when the host leaves', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.removePlayer('a')
    expect(room.snapshotLobby().players).toEqual([
      { id: 'b', isHost: true },
      { id: 'c', isHost: false },
    ])
  })

  it('reports the room as empty after everyone leaves', () => {
    room.addPlayer('a')
    room.removePlayer('a')
    expect(room.snapshotLobby()).toEqual({ players: [], status: 'waiting' })
  })
})
```

- [ ] **Step 3.2: Run the test, watch it fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: FAIL — `Cannot find module './game-room.service'`.

- [ ] **Step 3.3: Implement GameRoomService**

Create `apps/server/src/game/game-room.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { LobbyStatePayload, RoomStatus } from '@hips/shared'

@Injectable()
export class GameRoomService {
  private readonly playerOrder: string[] = []
  private status: RoomStatus = 'waiting'

  addPlayer(id: string): void {
    if (this.playerOrder.includes(id)) return
    this.playerOrder.push(id)
  }

  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
  }

  snapshotLobby(): LobbyStatePayload {
    return {
      players: this.playerOrder.map((id, i) => ({ id, isHost: i === 0 })),
      status: this.status,
    }
  }
}
```

- [ ] **Step 3.4: Run the test, watch it pass**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: 4 tests pass.

- [ ] **Step 3.5: Register the service**

Modify `apps/server/src/game/game.module.ts`:

```ts
import { Module } from '@nestjs/common'

import { GameGateway } from './game.gateway'
import { GameRoomService } from './game-room.service'

@Module({ providers: [GameGateway, GameRoomService] })
export class GameModule {}
```

- [ ] **Step 3.6: Wire the gateway to the service and broadcast lobby-state**

Replace `apps/server/src/game/game.gateway.ts` with:

```ts
import { Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { ClientToServerEvents, ServerToClientEvents } from '@hips/shared'
import type { Server, Socket } from 'socket.io'

import { GameRoomService } from './game-room.service'

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type AppServer = Server<ClientToServerEvents, ServerToClientEvents>

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  @WebSocketServer()
  private readonly server!: AppServer

  constructor(private readonly room: GameRoomService) {}

  handleConnection(socket: AppSocket): void {
    this.logger.log(`connected: ${socket.id}`)
    this.room.addPlayer(socket.id)
    this.broadcastLobby()
  }

  handleDisconnect(socket: AppSocket): void {
    this.logger.log(`disconnected: ${socket.id}`)
    this.room.removePlayer(socket.id)
    this.broadcastLobby()
  }

  private broadcastLobby(): void {
    this.server.emit('lobby-state', this.room.snapshotLobby())
  }
}
```

- [ ] **Step 3.7: Create the waiting-room overlay**

Create `apps/client/src/ui/WaitingRoomOverlay.ts`:

```ts
import { Container, Graphics, Text } from 'pixi.js'

import { Button } from './Button'

export interface WaitingRoomOverlayOptions {
  width: number
  height: number
  playerCount: number
  isHost: boolean
  onStart: () => void
}

export class WaitingRoomOverlay extends Container {
  private readonly count: Text
  private startBtn: Button | null = null
  private hostHint: Text | null = null

  constructor(private readonly opts: WaitingRoomOverlayOptions) {
    super()

    const dim = new Graphics()
      .rect(0, 0, opts.width, opts.height)
      .fill({ color: 0x000000, alpha: 0.85 })
    this.addChild(dim)

    const title = new Text({
      text: "Salle d'attente",
      style: { fill: 0xfff700, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(opts.width / 2, opts.height / 2 - 100)
    this.addChild(title)

    this.count = new Text({
      text: this.formatCount(opts.playerCount),
      style: { fill: 0xffffff, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    this.count.anchor.set(0.5)
    this.count.position.set(opts.width / 2, opts.height / 2 - 30)
    this.addChild(this.count)

    if (opts.isHost) this.addStartButton()
    else this.addNonHostHint()
  }

  setPlayerCount(n: number): void {
    this.count.text = this.formatCount(n)
  }

  setHost(isHost: boolean): void {
    if (isHost && !this.startBtn) {
      this.removeNonHostHint()
      this.addStartButton()
    } else if (!isHost && this.startBtn) {
      this.startBtn.destroy({ children: true })
      this.startBtn = null
      this.addNonHostHint()
    }
  }

  private formatCount(n: number): string {
    return `${n} joueur${n > 1 ? 's' : ''} connecté${n > 1 ? 's' : ''}`
  }

  private addStartButton(): void {
    const btn = new Button({ label: 'Démarrer', onClick: this.opts.onStart })
    btn.position.set(this.opts.width / 2, this.opts.height / 2 + 60)
    this.addChild(btn)
    this.startBtn = btn
  }

  private addNonHostHint(): void {
    if (this.hostHint) return
    const hint = new Text({
      text: "En attente de l'hôte…",
      style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    hint.anchor.set(0.5)
    hint.position.set(this.opts.width / 2, this.opts.height / 2 + 60)
    this.addChild(hint)
    this.hostHint = hint
  }

  private removeNonHostHint(): void {
    if (!this.hostHint) return
    this.hostHint.destroy()
    this.hostHint = null
  }
}
```

- [ ] **Step 3.8: Wire the overlay into GameScene**

This step replaces local sandbox rendering with the lobby flow. We keep the sandbox method bodies for now (they will be removed in Task 4) so manual play still works against the old code path; what changes is that on entering the scene, we connect, listen for `lobby-state`, and show the overlay.

Modify `apps/client/src/scenes/GameScene.ts`. Replace the `import` block and the top of the class with:

```ts
import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type {
  LobbyStatePayload,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'

import type { Game } from '../app/Game'
import {
  ARRIVAL_LINE_TOP_Y,
  CROSSHAIR_RADIUS,
  WORLD_HEIGHT,
  defaultGameConfig,
} from '../config/gameConfig'
import { ZOMBIE_SPRITES } from '../config/manifest'
import { Bot } from '../entities/Bot'
import { fire } from '../entities/Bullet'
import { Crosshair } from '../entities/Crosshair'
import { PlayerZombie } from '../entities/PlayerZombie'
import type { Zombie } from '../entities/Zombie'
import { WaitingRoomOverlay } from '../ui/WaitingRoomOverlay'

import { EndScene } from './EndScene'
import { Scene } from './Scene'

const TYPES: ZombieType[] = ['man', 'woman', 'wild']

const START_BAND_X = 30
const START_BAND_WIDTH = 40

export class GameScene extends Scene {
  private bgLayer!: Container
  private gameLayer!: Container
  private effectsLayer!: Container
  private playerZombie!: PlayerZombie
  private bots: Bot[] = []
  private crosshair!: Crosshair
  private bulletsRemaining = defaultGameConfig.bulletsPerPlayer
  private won = false
  private hud!: Text
  private waitingOverlay: WaitingRoomOverlay | null = null
  private lastLobby: LobbyStatePayload = { players: [], status: 'waiting' }
```

Replace `onEnter()` with:

```ts
  onEnter(): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.game.net.connect()
    this.game.net.on('lobby-state', (payload) => this.applyLobby(payload))
  }
```

Replace `onExit()` with:

```ts
  onExit(): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.game.net.off('lobby-state')
  }
```

Add these private methods at the bottom of the class:

```ts
  private showWaitingOverlay(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.waitingOverlay = new WaitingRoomOverlay({
      width: canvasWidth,
      height: canvasHeight,
      playerCount: 0,
      isHost: false,
      onStart: () => {
        // Wired in Task 4 — emit('start') here.
      },
    })
    this.addChild(this.waitingOverlay)
  }

  private applyLobby(payload: LobbyStatePayload): void {
    this.lastLobby = payload
    if (!this.waitingOverlay) return
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)
    this.waitingOverlay.setPlayerCount(payload.players.length)
    this.waitingOverlay.setHost(isHost)
  }
```

- [ ] **Step 3.9: Add the listener API to NetworkManager**

Modify `apps/client/src/systems/NetworkManager.ts`. Add inside the class:

```ts
  on<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
  ): void {
    if (!this.socket) throw new Error(`NetworkManager.on('${String(event)}') called before connect()`)
    // socket.io-client's typed `on` accepts the matching handler signature.
    this.socket.on(event, handler as never)
  }

  off<E extends keyof ServerToClientEvents>(event: E): void {
    this.socket?.removeAllListeners(event)
  }

  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void {
    if (!this.socket) throw new Error(`NetworkManager.emit('${String(event)}') called before connect()`)
    this.socket.emit(event, ...(args as never[]))
  }

  get id(): string | undefined {
    return this.socket?.id
  }
```

The `as never` casts are required because socket.io-client's generic-typed signatures use overload resolution that doesn't survive the `keyof` mapping cleanly; we keep the public API typed and the internal cast minimal.

- [ ] **Step 3.10: Run server tests + typecheck both apps**

Run:

```bash
pnpm --filter server test
pnpm -r typecheck
```

Expected: tests PASS, typecheck PASS.

- [ ] **Step 3.11: Manual two-tab demo**

Run server and client. Open two browser tabs at `http://localhost:5173`, click "Jouer" on each, wait for `LoadingScene` to finish.

Expected:

- Both tabs show the waiting-room overlay over the background.
- Both tabs display "2 joueurs connectés".
- Tab opened first shows the "Démarrer" button.
- Tab opened second shows "En attente de l'hôte…".
- Closing the first tab → second tab's overlay updates to show the Start button (host promotion) and "1 joueur connecté".

- [ ] **Step 3.12: Commit**

```bash
git add apps/server/package.json apps/server/src/game/ apps/client/src/ui/WaitingRoomOverlay.ts apps/client/src/systems/NetworkManager.ts apps/client/src/scenes/GameScene.ts pnpm-lock.yaml
git commit -m "feat(net): lobby state with host election and waiting overlay"
```

---

## Task 4: Game start + initial spawn

The host clicks "Démarrer" → server transitions the room to `running`, spawns each connected socket as a fresh `PlayerState`, broadcasts `game-started` with the initial snapshot. Client tears down the overlay and renders idle zombies in their server-assigned positions. No movement logic yet.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

- [ ] **Step 4.1: Write the failing start-spawn test**

Append to `apps/server/src/game/game-room.service.spec.ts`:

```ts
describe('GameRoomService — start', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
  })

  it('refuses start while there are no players', () => {
    expect(room.start('nobody')).toBeNull()
  })

  it('refuses start from a non-host', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    expect(room.start('b')).toBeNull()
    expect(room.snapshotLobby().status).toBe('waiting')
  })

  it('spawns each connected player at the start band when host starts', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    const result = room.start('a')
    expect(result).not.toBeNull()
    expect(result!.players).toHaveLength(2)
    for (const p of result!.players) {
      expect(p.x).toBeGreaterThanOrEqual(30)
      expect(p.x).toBeLessThanOrEqual(70)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(886)
      expect(p.animation).toBe('idle')
      expect(p.isAlive).toBe(true)
      expect(p.bulletsRemaining).toBe(1)
    }
    expect(room.snapshotLobby().status).toBe('running')
  })

  it('assigns zombie types in a stable cycle', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.addPlayer('d')
    const result = room.start('a')!
    expect(result.players.map((p) => p.type)).toEqual(['man', 'woman', 'wild', 'man'])
  })
})
```

- [ ] **Step 4.2: Run the test, watch it fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: FAIL — `room.start is not a function`.

- [ ] **Step 4.3: Implement start() and player state**

Modify `apps/server/src/game/game-room.service.ts`. Replace the file with:

```ts
import { Injectable } from '@nestjs/common'
import type {
  GameStartedPayload,
  LobbyStatePayload,
  PlayerState,
  RoomStatus,
  ZombieType,
} from '@hips/shared'
import { ARRIVAL_LINE_X, SPAWN_BAND_WIDTH, SPAWN_BAND_X, WORLD_HEIGHT } from '@hips/shared'

const TYPES: ZombieType[] = ['man', 'woman', 'wild']
const BULLETS_PER_PLAYER = 1

@Injectable()
export class GameRoomService {
  private readonly playerOrder: string[] = []
  private readonly players = new Map<string, PlayerState>()
  private status: RoomStatus = 'waiting'

  addPlayer(id: string): void {
    if (this.playerOrder.includes(id)) return
    this.playerOrder.push(id)
  }

  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
    this.players.delete(id)
  }

  snapshotLobby(): LobbyStatePayload {
    return {
      players: this.playerOrder.map((id, i) => ({ id, isHost: i === 0 })),
      status: this.status,
    }
  }

  start(requesterId: string): GameStartedPayload | null {
    if (this.status !== 'waiting') return null
    if (this.playerOrder.length === 0) return null
    if (this.playerOrder[0] !== requesterId) return null

    this.players.clear()
    this.playerOrder.forEach((id, i) => {
      this.players.set(id, this.spawnPlayer(id, i))
    })
    this.status = 'running'
    return {
      players: [...this.players.values()],
      arrivalLineX: ARRIVAL_LINE_X,
    }
  }

  private spawnPlayer(id: string, index: number): PlayerState {
    return {
      id,
      type: TYPES[index % TYPES.length]!,
      x: SPAWN_BAND_X + Math.random() * SPAWN_BAND_WIDTH,
      // Stagger Y so two players don't perfectly overlap on spawn.
      y: WORLD_HEIGHT * (0.3 + ((index * 0.13) % 0.6)) + 100,
      animation: 'idle',
      isAlive: true,
      bulletsRemaining: BULLETS_PER_PLAYER,
    }
  }
}
```

Note: `spawnPlayer` uses `Math.random()` for x. The test asserts only that x lies in `[30, 70]`, which the deterministic range still satisfies. Y staggering uses a deterministic step so the test (which doesn't seed RNG) is stable.

- [ ] **Step 4.4: Run the test, watch it pass**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: all 8 tests pass.

- [ ] **Step 4.5: Wire the gateway to handle 'start'**

Modify `apps/server/src/game/game.gateway.ts`. Add the `SubscribeMessage` import and handler.

Replace the imports block:

```ts
import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { ClientToServerEvents, ServerToClientEvents } from '@hips/shared'
import type { Server, Socket } from 'socket.io'

import { GameRoomService } from './game-room.service'
```

Add inside the class, after `broadcastLobby`:

```ts
  @SubscribeMessage('start')
  onStart(@ConnectedSocket() socket: AppSocket): void {
    const result = this.room.start(socket.id)
    if (!result) return
    this.server.emit('game-started', result)
    this.broadcastLobby()
  }
```

- [ ] **Step 4.6: Wire the start button on the client**

Modify `apps/client/src/scenes/GameScene.ts`. Replace the `onStart` callback in `showWaitingOverlay`:

```ts
      onStart: () => {
        this.game.net.emit('start')
      },
```

- [ ] **Step 4.7: Render the initial spawn on game-started**

Still in `apps/client/src/scenes/GameScene.ts`. The current `onEnter` calls `spawnBots`, `spawnPlayer`, `spawnCrosshair`, `drawArrivalLine`, `buildHud` — those are the old solo-sandbox path. Strip them and replace with a network-driven flow.

Replace `onEnter()` with:

```ts
  onEnter(): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.game.net.connect()
    this.game.net.on('lobby-state', (payload) => this.applyLobby(payload))
    this.game.net.on('game-started', (payload) => this.startGame(payload))
  }
```

Replace `onExit()` with:

```ts
  onExit(): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.game.net.off('lobby-state')
    this.game.net.off('game-started')
  }
```

Replace the existing `update()` body, removing the local sandbox logic. New `update()`:

```ts
  update(_delta: number): void {
    if (!this.gameStarted) return
    // Crosshair lives in screen space.
    this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)
    // Depth sort by feet y.
    for (const z of this.remoteZombies.values()) z.zIndex = z.y
  }
```

Add fields next to the existing private declarations:

```ts
  private gameStarted = false
  private remoteZombies = new Map<string, PlayerZombie>()
  private arrivalLineX = 0
```

Remove the now-unused imports / fields / methods. Specifically:

- Remove fields: `playerZombie`, `bots`, `bulletsRemaining`, `won`, `hud`.
- Remove imports: `Bot` (`../entities/Bot`), `fire` (`../entities/Bullet`), `Zombie` type (`../entities/Zombie`), `defaultGameConfig`, `CROSSHAIR_RADIUS`, `WORLD_HEIGHT` (all from `../config/gameConfig`).
- Keep imports: `ZOMBIE_SPRITES` (still used by `zombieFrameCounts`), `Crosshair`, `PlayerZombie`, `WaitingRoomOverlay`, `ARRIVAL_LINE_TOP_Y`.
- Remove the methods `spawnBots`, `spawnPlayer`, `spawnCrosshair`, `drawArrivalLine`, `buildHud`, `refreshHud`. Their replacements live in `startGame` below — note that `spawnCrosshair` and `drawArrivalLine` are re-added with adapted bodies as part of `startGame`.

Add the `startGame` method:

```ts
  private startGame(payload: GameStartedPayload): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null

    this.arrivalLineX = payload.arrivalLineX

    this.spawnCrosshair()
    this.drawArrivalLine()

    for (const state of payload.players) {
      const zombie = this.makeZombie(state)
      this.remoteZombies.set(state.id, zombie)
      this.gameLayer.addChild(zombie)
    }

    this.gameStarted = true
  }

  private spawnCrosshair(): void {
    this.crosshair = new Crosshair()
    this.crosshair.position.set(
      this.game.layout.canvasWidth / 2,
      this.game.layout.canvasHeight / 2,
    )
    this.effectsLayer.addChild(this.crosshair)
  }

  private drawArrivalLine(): void {
    const { canvasHeight, playArea, worldScale } = this.game.layout
    const bottomWorldY = (canvasHeight - playArea.y) / worldScale
    const line = new Graphics()
    const dashHeight = 14
    const gap = 8
    let y = ARRIVAL_LINE_TOP_Y
    while (y < bottomWorldY) {
      line.moveTo(this.arrivalLineX, y).lineTo(
        this.arrivalLineX,
        Math.min(y + dashHeight, bottomWorldY),
      )
      y += dashHeight + gap
    }
    line.stroke({ width: 3, color: 0xfff700 })
    this.gameLayer.addChild(line)
  }

  private makeZombie(state: PlayerState): PlayerZombie {
    const zombie = new PlayerZombie({
      type: state.type,
      textures: this.zombieTextures(state.type),
      frameCounts: this.zombieFrameCounts(state.type),
    })
    zombie.x = state.x
    zombie.y = state.y
    zombie.scale.set(this.game.layout.zombieScale)
    zombie.applyServerState(state)
    return zombie
  }
```

Add the import for `GameStartedPayload` and `PlayerState` to the import block at the top:

```ts
import type {
  GameStartedPayload,
  LobbyStatePayload,
  PlayerState,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'
```

- [ ] **Step 4.8: Refactor PlayerZombie to accept server state**

Modify `apps/client/src/entities/PlayerZombie.ts`. Replace the file with:

```ts
import type { PlayerState } from '@hips/shared'

import { Zombie, type ZombieDeps } from './Zombie'

export class PlayerZombie extends Zombie {
  // PlayerZombie no longer reads input directly; it is a pure renderer
  // driven by server state. The Zombie base class handles animation switching
  // and aabb computation; this class is only responsible for applying snapshots.
  constructor(deps: ZombieDeps) {
    super(deps)
  }

  applyServerState(state: PlayerState): void {
    this.x = state.x
    this.y = state.y
    if (state.isAlive !== this.isAlive) {
      if (!state.isAlive) this.die()
    }
    this.playAnimation(state.animation)
  }

  override update(_delta: number): void {
    // No local logic. Server snapshots drive position and animation via
    // applyServerState() called from GameScene.
  }
}
```

Note: this removes the `walkSpeed`/`runSpeed`/`input` constructor props. Any caller still passing them (the old `GameScene.spawnPlayer`) is removed in step 4.7.

- [ ] **Step 4.9: Verify typecheck**

Run:

```bash
pnpm -r typecheck
```

Expected: PASS. If failures, address them — most likely candidates: leftover `bots`/`playerZombie` references in `GameScene`, or stale imports.

- [ ] **Step 4.10: Manual two-tab demo**

Run server + client. Two tabs into `GameScene`. Host (tab 1) clicks "Démarrer".

Expected:

- Both tabs simultaneously dismiss the overlay.
- Both tabs render the same N idle zombies at the same positions (allowing for the small random x jitter — which is identical because the server computed it once and broadcast it).
- The dashed arrival line appears on the right.
- The crosshair follows the mouse on each tab.
- Nothing moves yet (Space does nothing).

- [ ] **Step 4.11: Commit**

```bash
git add apps/server/src/game/ apps/client/src/scenes/GameScene.ts apps/client/src/entities/PlayerZombie.ts
git commit -m "feat(net): server-driven game start + initial player spawn"
```

---

## Task 5: Movement sync

Players send `input` events when their key/pointer state changes. The server tick loop integrates that input at 30 Hz, broadcasts a full snapshot every tick, and the client reconciles its entities by id.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

- [ ] **Step 5.1: Write the failing input-then-tick test**

Append to `apps/server/src/game/game-room.service.spec.ts`:

```ts
import { SERVER_TICK_HZ, WALK_SPEED, RUN_SPEED } from '@hips/shared'

describe('GameRoomService — movement', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.start('a')
  })

  it('does not move a player whose space is not held', () => {
    const before = room.snapshotState().players[0]!
    room.tick()
    const after = room.snapshotState().players[0]!
    expect(after.x).toBe(before.x)
    expect(after.animation).toBe('idle')
  })

  it('walks a player when space is held', () => {
    room.applyInput('a', {
      keys: { space: true, shift: false },
      pointer: { x: 0, y: 0 },
    })
    const before = room.snapshotState().players[0]!.x
    room.tick()
    const after = room.snapshotState().players[0]!
    expect(after.x).toBeCloseTo(before + WALK_SPEED * (60 / SERVER_TICK_HZ), 5)
    expect(after.animation).toBe('walk')
  })

  it('runs a player when shift+space is held', () => {
    room.applyInput('a', {
      keys: { space: true, shift: true },
      pointer: { x: 0, y: 0 },
    })
    const before = room.snapshotState().players[0]!.x
    room.tick()
    const after = room.snapshotState().players[0]!
    expect(after.x).toBeCloseTo(before + RUN_SPEED * (60 / SERVER_TICK_HZ), 5)
    expect(after.animation).toBe('run')
  })

  it('does not move a dead player', () => {
    const id = 'a'
    // Force-kill via internal state for this test.
    room.killForTest(id)
    room.applyInput(id, {
      keys: { space: true, shift: false },
      pointer: { x: 0, y: 0 },
    })
    const before = room.snapshotState().players[0]!.x
    room.tick()
    expect(room.snapshotState().players[0]!.x).toBe(before)
  })
})
```

- [ ] **Step 5.2: Run the test, watch it fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: FAIL — methods `tick`, `applyInput`, `snapshotState`, `killForTest` not defined.

- [ ] **Step 5.3: Implement input + tick on the room service**

Modify `apps/server/src/game/game-room.service.ts`. Add the imports and types at the top:

```ts
import {
  ARRIVAL_LINE_X,
  RUN_SPEED,
  SERVER_TICK_HZ,
  SPAWN_BAND_WIDTH,
  SPAWN_BAND_X,
  WALK_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '@hips/shared'
import type {
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerState,
  RoomStatus,
  StatePayload,
  ZombieType,
} from '@hips/shared'
```

Add a private input map and constants near the top of the class:

```ts
  private readonly inputs = new Map<string, InputPayload>()
  private static readonly TICK_SCALE = 60 / SERVER_TICK_HZ
```

Add inside the class:

```ts
  applyInput(id: string, input: InputPayload): void {
    if (!this.players.has(id)) return
    this.inputs.set(id, input)
  }

  tick(): void {
    if (this.status !== 'running') return
    for (const player of this.players.values()) {
      if (!player.isAlive) {
        player.animation = 'die'
        continue
      }
      const input = this.inputs.get(player.id)
      const space = input?.keys.space ?? false
      const shift = input?.keys.shift ?? false
      if (space && shift) {
        player.animation = 'run'
        player.x += RUN_SPEED * GameRoomService.TICK_SCALE
      } else if (space) {
        player.animation = 'walk'
        player.x += WALK_SPEED * GameRoomService.TICK_SCALE
      } else {
        player.animation = 'idle'
      }
      // Clamp to play area on x; y is fixed (no vertical movement in MVP).
      if (player.x < 0) player.x = 0
      if (player.x > WORLD_WIDTH) player.x = WORLD_WIDTH
    }
  }

  snapshotState(): StatePayload {
    return { players: [...this.players.values()].map((p) => ({ ...p })) }
  }

  // Test-only helper to flip a player to dead without going through the
  // full fire/hit pipeline (which is exercised in the collision tests).
  killForTest(id: string): void {
    const p = this.players.get(id)
    if (p) {
      p.isAlive = false
      p.animation = 'die'
    }
  }
```

Update `removePlayer` to also clear inputs:

```ts
  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
    this.players.delete(id)
    this.inputs.delete(id)
  }
```

- [ ] **Step 5.4: Run the test, watch it pass**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: 12 tests pass.

- [ ] **Step 5.5: Wire input handler + tick loop in the gateway**

Modify `apps/server/src/game/game.gateway.ts`. Add `MessageBody` to the imports:

```ts
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
```

Add the `SERVER_TICK_HZ` import:

```ts
import { SERVER_TICK_HZ } from '@hips/shared'
```

Add a private `tickHandle` field and lifecycle:

```ts
  private tickHandle: NodeJS.Timeout | null = null
```

Modify `onStart` to launch the tick loop:

```ts
  @SubscribeMessage('start')
  onStart(@ConnectedSocket() socket: AppSocket): void {
    const result = this.room.start(socket.id)
    if (!result) return
    this.server.emit('game-started', result)
    this.broadcastLobby()
    this.startTickLoop()
  }
```

Add the input handler and tick-loop helpers:

```ts
  @SubscribeMessage('input')
  onInput(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: InputPayload,
  ): void {
    this.room.applyInput(socket.id, payload)
  }

  private startTickLoop(): void {
    if (this.tickHandle) return
    const intervalMs = 1000 / SERVER_TICK_HZ
    this.tickHandle = setInterval(() => {
      this.room.tick()
      this.server.emit('state', this.room.snapshotState())
    }, intervalMs)
  }

  private stopTickLoop(): void {
    if (!this.tickHandle) return
    clearInterval(this.tickHandle)
    this.tickHandle = null
  }
```

Add the `InputPayload` import alongside the other shared imports:

```ts
import type { ClientToServerEvents, InputPayload, ServerToClientEvents } from '@hips/shared'
```

- [ ] **Step 5.6: Emit input from the client when state changes**

Modify `apps/client/src/scenes/GameScene.ts`. Add fields:

```ts
  private lastSentInput: InputPayload | null = null
  private worldPointer = { x: 0, y: 0 }
```

Add the import:

```ts
import type {
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerState,
  StatePayload,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'
```

Replace `update()` with:

```ts
  update(_delta: number): void {
    if (!this.gameStarted) return
    this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)
    this.worldPointer = this.gameLayer.toLocal({
      x: this.crosshair.x,
      y: this.crosshair.y,
    })

    this.maybeEmitInput()

    for (const z of this.remoteZombies.values()) z.zIndex = z.y
  }

  private maybeEmitInput(): void {
    const next: InputPayload = {
      keys: {
        space: this.game.input.isDown(' '),
        shift: this.game.input.isDown('Shift'),
      },
      pointer: { x: this.worldPointer.x, y: this.worldPointer.y },
    }
    if (this.shouldSend(next)) {
      this.game.net.emit('input', next)
      this.lastSentInput = next
    }
  }

  private shouldSend(next: InputPayload): boolean {
    const last = this.lastSentInput
    if (!last) return true
    if (last.keys.space !== next.keys.space) return true
    if (last.keys.shift !== next.keys.shift) return true
    // Throttle pointer updates: emit when it has moved by more than 4 world units.
    const dx = last.pointer.x - next.pointer.x
    const dy = last.pointer.y - next.pointer.y
    return dx * dx + dy * dy > 16
  }
```

- [ ] **Step 5.7: Reconcile entities from server snapshots**

Still in `apps/client/src/scenes/GameScene.ts`. Subscribe in `onEnter` and unsubscribe in `onExit`:

```ts
  onEnter(): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.game.net.connect()
    this.game.net.on('lobby-state', (payload) => this.applyLobby(payload))
    this.game.net.on('game-started', (payload) => this.startGame(payload))
    this.game.net.on('state', (payload) => this.applyState(payload))
  }

  onExit(): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.game.net.off('lobby-state')
    this.game.net.off('game-started')
    this.game.net.off('state')
  }
```

Add `applyState`:

```ts
  private applyState(payload: StatePayload): void {
    if (!this.gameStarted) return
    const seen = new Set<string>()
    for (const state of payload.players) {
      seen.add(state.id)
      const existing = this.remoteZombies.get(state.id)
      if (existing) {
        existing.applyServerState(state)
      } else {
        const z = this.makeZombie(state)
        this.remoteZombies.set(state.id, z)
        this.gameLayer.addChild(z)
      }
    }
    // Remove entities that vanished from the snapshot (covered fully in Task 8;
    // here it's a defensive pass so late-join recovery works correctly).
    for (const [id, z] of this.remoteZombies) {
      if (!seen.has(id)) {
        z.destroy({ children: true })
        this.remoteZombies.delete(id)
      }
    }
  }
```

- [ ] **Step 5.8: Run server tests + typecheck**

Run:

```bash
pnpm --filter server test
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 5.9: Manual two-tab demo**

Run server + client. Two tabs into GameScene → host clicks Démarrer.

Expected:

- Hold Space in tab 1 → both tabs see tab-1's zombie walk forward at ~1 px/tick.
- Hold Shift+Space → both tabs see tab-1's zombie run forward.
- Release → both tabs see the zombie return to idle.
- Tab 2 holding Space simultaneously moves its own zombie on both screens.
- Movement is smooth-ish at 30 Hz (some jitter on the local zombie because it lives behind ~1 frame of network round-trip; this is documented in the spec's risks).

- [ ] **Step 5.10: Commit**

```bash
git add apps/server/src/game/ apps/client/src/scenes/GameScene.ts
git commit -m "feat(net): server-tick movement with input emission and snapshot sync"
```

---

## Task 6: Shoot + hit detection

Click → client emits `fire` with the world-space pointer → server runs point-in-AABB on alive players (excluding shooter), broadcasts `shot-fired` (always) and `player-killed` (on hit). Client renders fire/blood effects exclusively from server events.

**Files:**

- Create: `apps/server/src/game/zombie-aabb.ts`
- Create: `apps/server/src/game/collision.ts`
- Create: `apps/server/src/game/collision.spec.ts`
- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

- [ ] **Step 6.1: Add per-type AABB constants**

Create `apps/server/src/game/zombie-aabb.ts`:

```ts
import type { ZombieType } from '@hips/shared'

// Mirror of apps/client/src/config/manifest.ts: ZOMBIE_BODY_BOX.
// Kept in the server module for now to avoid pulling client-only files
// into the shared package (which would force a Pixi-free split).
export const ZOMBIE_BODY_BOX: Record<ZombieType, { width: number; height: number }> = {
  man: { width: 40, height: 65 },
  woman: { width: 40, height: 65 },
  wild: { width: 75, height: 35 },
}
```

- [ ] **Step 6.2: Write the failing collision tests**

Create `apps/server/src/game/collision.spec.ts`:

```ts
import { findNearestHit, isPointInAABB, type ServerAABB } from './collision'

describe('isPointInAABB', () => {
  const box: ServerAABB = { x: 100, y: 200, width: 40, height: 60 }

  it('returns true when the point is strictly inside', () => {
    expect(isPointInAABB({ x: 110, y: 220 }, box)).toBe(true)
  })

  it('returns true on the boundary', () => {
    expect(isPointInAABB({ x: 100, y: 200 }, box)).toBe(true)
    expect(isPointInAABB({ x: 140, y: 260 }, box)).toBe(true)
  })

  it('returns false when outside', () => {
    expect(isPointInAABB({ x: 99, y: 220 }, box)).toBe(false)
    expect(isPointInAABB({ x: 110, y: 261 }, box)).toBe(false)
  })
})

describe('findNearestHit', () => {
  it('returns null when no zombie contains the point', () => {
    const z = [{ id: 'a', x: 0, y: 0, type: 'man' as const, isAlive: true }]
    expect(findNearestHit({ x: 1000, y: 1000 }, z)).toBeNull()
  })

  it('returns the only zombie whose AABB contains the point', () => {
    const z = [{ id: 'a', x: 100, y: 500, type: 'man' as const, isAlive: true }]
    // 'man' box is 40 wide × 65 tall, anchor (0.5, 1.0) → x∈[80,120], y∈[435,500]
    expect(findNearestHit({ x: 100, y: 480 }, z)?.id).toBe('a')
  })

  it('picks the zombie with highest y (drawn last) when several overlap', () => {
    const z = [
      { id: 'back', x: 100, y: 480, type: 'man' as const, isAlive: true },
      { id: 'front', x: 100, y: 500, type: 'man' as const, isAlive: true },
    ]
    expect(findNearestHit({ x: 100, y: 460 }, z)?.id).toBe('front')
  })

  it('ignores dead zombies', () => {
    const z = [{ id: 'dead', x: 100, y: 500, type: 'man' as const, isAlive: false }]
    expect(findNearestHit({ x: 100, y: 480 }, z)).toBeNull()
  })
})
```

- [ ] **Step 6.3: Run the test, watch it fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=collision
```

Expected: FAIL — module not found.

- [ ] **Step 6.4: Implement collision**

Create `apps/server/src/game/collision.ts`:

```ts
import type { ZombieType } from '@hips/shared'

import { ZOMBIE_BODY_BOX } from './zombie-aabb'

export interface Point {
  x: number
  y: number
}

export interface ServerAABB {
  x: number
  y: number
  width: number
  height: number
}

export interface CollidableTarget {
  id: string
  x: number
  y: number
  type: ZombieType
  isAlive: boolean
}

export function isPointInAABB(point: Point, box: ServerAABB): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

export function aabbFor(target: CollidableTarget): ServerAABB {
  // Mirror Zombie.aabb on the client: anchor (0.5, 1.0), so the box hangs
  // upward from feet.
  const box = ZOMBIE_BODY_BOX[target.type]
  return {
    x: target.x - box.width / 2,
    y: target.y - box.height,
    width: box.width,
    height: box.height,
  }
}

export function findNearestHit<T extends CollidableTarget>(
  point: Point,
  targets: readonly T[],
): T | null {
  const containing = targets.filter((t) => t.isAlive && isPointInAABB(point, aabbFor(t)))
  if (containing.length === 0) return null
  // Prefer the zombie drawn in front (highest y), matching the client's
  // depth-sort tiebreak in CollisionDetector.
  containing.sort((a, b) => b.y - a.y)
  return containing[0] ?? null
}
```

- [ ] **Step 6.5: Run the test, watch it pass**

Run:

```bash
pnpm --filter server test -- --testPathPattern=collision
```

Expected: 7 tests pass.

- [ ] **Step 6.6: Write the failing fire-handling test**

Append to `apps/server/src/game/game-room.service.spec.ts`:

```ts
describe('GameRoomService — fire', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
  })

  it('returns a miss when the pointer hits no one', () => {
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    const result = room.fire('a', { x: a.x + 1000, y: a.y + 1000 })
    expect(result).toEqual({
      shooterId: 'a',
      origin: { x: a.x + 1000, y: a.y + 1000 },
      hit: null,
    })
  })

  it('marks the target dead on a hit and decrements the bullet', () => {
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(result.hit).toEqual({ targetId: 'b' })
    const after = room.snapshotState()
    expect(after.players.find((p) => p.id === 'b')!.isAlive).toBe(false)
    expect(after.players.find((p) => p.id === 'b')!.animation).toBe('die')
    expect(after.players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(0)
  })

  it('refuses to shoot oneself', () => {
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    const result = room.fire('a', { x: a.x, y: a.y - 10 })
    expect(result.hit).toBeNull()
  })

  it('refuses to fire when no bullets remain', () => {
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    room.fire('a', { x: b.x, y: b.y - 10 }) // burns the only bullet
    const second = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(second).toBeNull()
  })

  it('refuses to fire when the shooter is dead', () => {
    room.killForTest('a')
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    expect(room.fire('a', { x: b.x, y: b.y - 10 })).toBeNull()
  })
})
```

- [ ] **Step 6.7: Run the test, watch it fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: FAIL — `room.fire is not a function`.

- [ ] **Step 6.8: Implement fire()**

Modify `apps/server/src/game/game-room.service.ts`. Add the import:

```ts
import { findNearestHit } from './collision'
```

Add at the bottom of the class:

```ts
  fire(
    shooterId: string,
    pointer: { x: number; y: number },
  ): { shooterId: string; origin: { x: number; y: number }; hit: { targetId: string } | null } | null {
    if (this.status !== 'running') return null
    const shooter = this.players.get(shooterId)
    if (!shooter || !shooter.isAlive || shooter.bulletsRemaining <= 0) return null

    shooter.bulletsRemaining -= 1

    const candidates = [...this.players.values()].filter((p) => p.id !== shooterId)
    const hit = findNearestHit(pointer, candidates)
    if (hit) {
      hit.isAlive = false
      hit.animation = 'die'
    }
    return {
      shooterId,
      origin: pointer,
      hit: hit ? { targetId: hit.id } : null,
    }
  }
```

- [ ] **Step 6.9: Run all server tests, watch them pass**

Run:

```bash
pnpm --filter server test
```

Expected: ALL pass.

- [ ] **Step 6.10: Wire the fire handler in the gateway**

Modify `apps/server/src/game/game.gateway.ts`. Add the `FirePayload` import:

```ts
import type {
  ClientToServerEvents,
  FirePayload,
  InputPayload,
  ServerToClientEvents,
} from '@hips/shared'
```

Add inside the class:

```ts
  @SubscribeMessage('fire')
  onFire(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: FirePayload,
  ): void {
    const result = this.room.fire(socket.id, payload.pointer)
    if (!result) return
    this.server.emit('shot-fired', result)
    if (result.hit) {
      this.server.emit('player-killed', { id: result.hit.targetId })
    }
  }
```

- [ ] **Step 6.11: Emit fire from the client and render effects from server events**

Modify `apps/client/src/scenes/GameScene.ts`. Re-add `fire`-related imports — but we don't reuse `entities/Bullet.ts` because the local function does its own collision; we now want pure visual effects.

Add the imports for the FX (re-using `BloodSplat` and `FireShot` directly):

```ts
import { BloodSplat } from '../entities/BloodSplat'
import { FireShot } from '../entities/FireShot'
```

Hook the events up in `onEnter`:

```ts
this.game.net.on('shot-fired', (payload) => this.onShotFired(payload))
this.game.net.on('player-killed', (payload) => this.onPlayerKilled(payload))
```

And in `onExit`:

```ts
this.game.net.off('shot-fired')
this.game.net.off('player-killed')
```

Add the click-emits-fire wiring inside `update()`, right before the depth-sort loop:

```ts
if (this.game.input.consumeFire()) {
  this.game.net.emit('fire', { pointer: { ...this.worldPointer } })
}
```

Add the handlers:

```ts
  private onShotFired(payload: ShotFiredPayload): void {
    const fx = payload.hit
      ? new BloodSplat(this.game.assets)
      : new FireShot(this.game.assets)
    fx.position.set(payload.origin.x, payload.origin.y)
    this.gameLayer.addChild(fx)
  }

  private onPlayerKilled(payload: PlayerKilledPayload): void {
    const z = this.remoteZombies.get(payload.id)
    if (z) z.die()
  }
```

Add the imports for the payload types:

```ts
import type {
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerKilledPayload,
  PlayerState,
  ShotFiredPayload,
  StatePayload,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'
```

- [ ] **Step 6.12: Run server tests + typecheck**

Run:

```bash
pnpm --filter server test
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 6.13: Manual two-tab demo**

Two tabs, host starts the game.

Expected:

- Tab 1 clicks on tab 2's zombie → both tabs render a `BloodSplat` at the click point and tab 2's zombie plays `die`.
- Tab 2 then can no longer move (server stops applying input on dead players).
- Tab 1 clicks again → nothing happens (out of bullets).
- Tab 1 clicks where there's no one → both tabs render a `FireShot` muzzle flash, no kill.
- The HUD bullet count on the local client is no longer shown — that's expected; in MVP the only feedback for being out of bullets is "click does nothing visible". (Adding it back is a polish item.)

- [ ] **Step 6.14: Commit**

```bash
git add apps/server/src/game/ apps/client/src/scenes/GameScene.ts
git commit -m "feat(net): server-side fire + hit detection with broadcast effects"
```

---

## Task 7: Win condition + EndScene transition

The server detects `player.x >= ARRIVAL_LINE_X` during `tick`, transitions to `ended`, broadcasts `game-ended`, and stops the tick loop. Clients transition to `EndScene` with `won = (myId === winnerId)`.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

- [ ] **Step 7.1: Write the failing arrival-line test**

Append to `apps/server/src/game/game-room.service.spec.ts`:

```ts
import { ARRIVAL_LINE_X } from '@hips/shared'

describe('GameRoomService — win condition', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
  })

  it('returns null from tickAndCheckWinner while no one has crossed', () => {
    expect(room.tickAndCheckWinner()).toBeNull()
  })

  it('declares the player who crosses the arrival line as winner', () => {
    // Teleport 'a' just past the line so the next tick triggers the check.
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    const winner = room.tickAndCheckWinner()
    expect(winner).toEqual({ winnerId: 'a' })
    expect(room.snapshotLobby().status).toBe('ended')
  })

  it('ignores dead players for the arrival check', () => {
    room.killForTest('a')
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    expect(room.tickAndCheckWinner()).toBeNull()
  })
})
```

- [ ] **Step 7.2: Run the test, watch it fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: FAIL — `tickAndCheckWinner` and `teleportForTest` not defined.

- [ ] **Step 7.3: Implement win check**

Modify `apps/server/src/game/game-room.service.ts`. Add inside the class:

```ts
  // Convenience method: tick + arrival-line check, used by the gateway loop.
  tickAndCheckWinner(): { winnerId: string } | null {
    if (this.status !== 'running') return null
    this.tick()
    for (const p of this.players.values()) {
      if (p.isAlive && p.x >= ARRIVAL_LINE_X) {
        this.status = 'ended'
        return { winnerId: p.id }
      }
    }
    return null
  }

  // Test-only helper.
  teleportForTest(id: string, x: number): void {
    const p = this.players.get(id)
    if (p) p.x = x
  }
```

- [ ] **Step 7.4: Run all tests, watch them pass**

Run:

```bash
pnpm --filter server test
```

Expected: PASS.

- [ ] **Step 7.5: Wire game-ended into the gateway loop**

Modify `apps/server/src/game/game.gateway.ts`. Replace `startTickLoop`:

```ts
  private startTickLoop(): void {
    if (this.tickHandle) return
    const intervalMs = 1000 / SERVER_TICK_HZ
    this.tickHandle = setInterval(() => {
      const winner = this.room.tickAndCheckWinner()
      this.server.emit('state', this.room.snapshotState())
      if (winner) {
        this.stopTickLoop()
        this.server.emit('game-ended', winner)
        this.broadcastLobby()
      }
    }, intervalMs)
  }
```

- [ ] **Step 7.6: Transition to EndScene on the client**

Modify `apps/client/src/scenes/GameScene.ts`.

In `onEnter`, add:

```ts
this.game.net.on('game-ended', (payload) => this.onGameEnded(payload))
```

In `onExit`, add:

```ts
this.game.net.off('game-ended')
```

Add the import:

```ts
import type {
  GameEndedPayload,
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerKilledPayload,
  PlayerState,
  ShotFiredPayload,
  StatePayload,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'
```

Add the handler:

```ts
  private onGameEnded(payload: GameEndedPayload): void {
    const won = payload.winnerId === this.game.net.id
    void this.game.sceneManager.goTo(new EndScene(this.game), { won })
  }
```

- [ ] **Step 7.7: Run server tests + typecheck**

Run:

```bash
pnpm --filter server test
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 7.8: Manual two-tab demo**

Host two tabs, start game. Hold Shift+Space in tab 1 until the zombie crosses the dashed line.

Expected:

- The instant the line is crossed, both tabs transition to `EndScene`.
- Tab 1 sees "Gagné !".
- Tab 2 sees "Perdu".
- The arrival-line crossing is sharp (no further state snapshots after).

- [ ] **Step 7.9: Commit**

```bash
git add apps/server/src/game/ apps/client/src/scenes/GameScene.ts
git commit -m "feat(net): server-side win detection + synchronized EndScene"
```

---

## Task 8: Disconnect cleanup + replay

A disconnect during `running` removes the player from the snapshot, which the existing reconcile loop already cleans up; we just confirm it via test. Replay adds a `replay` event the host can emit from the EndScene to reset the room to `waiting`.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`
- Modify: `apps/server/src/game/game.gateway.ts`
- Modify: `apps/client/src/scenes/EndScene.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

- [ ] **Step 8.1: Write the failing disconnect-during-running and replay tests**

Append to `apps/server/src/game/game-room.service.spec.ts`:

```ts
describe('GameRoomService — disconnect during running', () => {
  it('removes the player from the snapshot', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
    room.removePlayer('b')
    const ids = room.snapshotState().players.map((p) => p.id)
    expect(ids).toEqual(['a'])
  })
})

describe('GameRoomService — replay', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
  })

  it('refuses replay from a non-host', () => {
    expect(room.replay('b')).toBe(false)
  })

  it('refuses replay while not in ended state', () => {
    const fresh = new GameRoomService()
    fresh.addPlayer('a')
    expect(fresh.replay('a')).toBe(false)
  })

  it('resets the room to waiting on host replay', () => {
    expect(room.replay('a')).toBe(true)
    expect(room.snapshotLobby().status).toBe('waiting')
    expect(room.snapshotState().players).toHaveLength(0)
  })
})
```

- [ ] **Step 8.2: Run the tests, watch them fail**

Run:

```bash
pnpm --filter server test -- --testPathPattern=game-room
```

Expected: FAIL — `room.replay` not defined.

- [ ] **Step 8.3: Implement replay**

Modify `apps/server/src/game/game-room.service.ts`. Add at the bottom of the class:

```ts
  replay(requesterId: string): boolean {
    if (this.status !== 'ended') return false
    if (this.playerOrder[0] !== requesterId) return false
    this.status = 'waiting'
    this.players.clear()
    this.inputs.clear()
    return true
  }
```

- [ ] **Step 8.4: Run all server tests, watch them pass**

Run:

```bash
pnpm --filter server test
```

Expected: PASS.

- [ ] **Step 8.5: Update gateway: handle disconnect-during-running and add replay**

Modify `apps/server/src/game/game.gateway.ts`.

In `handleDisconnect`, also broadcast `player-left` so clients can immediately remove the entity:

```ts
  handleDisconnect(socket: AppSocket): void {
    this.logger.log(`disconnected: ${socket.id}`)
    this.room.removePlayer(socket.id)
    this.server.emit('player-left', { id: socket.id })
    this.broadcastLobby()
  }
```

Add the replay handler:

```ts
  @SubscribeMessage('replay')
  onReplay(@ConnectedSocket() socket: AppSocket): void {
    if (!this.room.replay(socket.id)) return
    this.broadcastLobby()
  }
```

(`stopTickLoop` is already called inside `startTickLoop` when a winner is detected, so the room is idle by the time `replay` is allowed.)

- [ ] **Step 8.6: Handle player-left, accept replay scene params, on the client**

Modify `apps/client/src/scenes/GameScene.ts`.

Change `onEnter` to accept `params` and apply an optional initial lobby payload (used when EndScene transitions back here after a replay):

```ts
  onEnter(params?: unknown): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.game.net.connect()
    this.game.net.on('lobby-state', (payload) => this.applyLobby(payload))
    this.game.net.on('game-started', (payload) => this.startGame(payload))
    this.game.net.on('state', (payload) => this.applyState(payload))
    this.game.net.on('shot-fired', (payload) => this.onShotFired(payload))
    this.game.net.on('player-killed', (payload) => this.onPlayerKilled(payload))
    this.game.net.on('game-ended', (payload) => this.onGameEnded(payload))
    this.game.net.on('player-left', (payload) => this.onPlayerLeft(payload))

    const initial = (params as { initialLobby?: LobbyStatePayload } | undefined)
      ?.initialLobby
    if (initial) this.applyLobby(initial)
  }
```

(The full set of `on(...)` calls is the cumulative result through tasks 3–8 — replace whatever your `onEnter` looks like at this point with this version.)

In `onExit`, add the new unsubscription:

```ts
this.game.net.off('player-left')
```

Add the handler:

```ts
  private onPlayerLeft(payload: PlayerLeftPayload): void {
    const z = this.remoteZombies.get(payload.id)
    if (!z) return
    z.destroy({ children: true })
    this.remoteZombies.delete(payload.id)
  }
```

Add the import:

```ts
import type {
  GameEndedPayload,
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerKilledPayload,
  PlayerLeftPayload,
  PlayerState,
  ShotFiredPayload,
  StatePayload,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'
```

- [ ] **Step 8.7: Wire the replay button in EndScene**

Modify `apps/client/src/scenes/EndScene.ts`. Replace the file with:

```ts
import { Text } from 'pixi.js'
import type { LobbyStatePayload } from '@hips/shared'

import type { Game } from '../app/Game'
import { Button } from '../ui/Button'

import { GameScene } from './GameScene'
import { Scene } from './Scene'

export interface EndSceneParams {
  won: boolean
}

export class EndScene extends Scene {
  private message!: Text
  private elapsed = 0
  private replayBtn: Button | null = null
  private hint: Text | null = null

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(params?: unknown): void {
    const won = (params as EndSceneParams | undefined)?.won ?? true
    const { canvasWidth, canvasHeight } = this.game.layout

    this.message = new Text({
      text: won ? 'Gagné !' : 'Perdu',
      style: { fill: 0xfff700, fontSize: 80, fontFamily: 'Space Mono, monospace' },
    })
    this.message.anchor.set(0.5)
    this.message.position.set(canvasWidth / 2, canvasHeight / 2 - 60)
    this.message.alpha = 0
    this.message.scale.set(0.4)
    this.addChild(this.message)

    // Listen for the lobby reset that follows a successful replay.
    this.game.net.on('lobby-state', (payload) => this.onLobbyState(payload))
  }

  onExit(): void {
    this.game.net.off('lobby-state')
  }

  update(delta: number): void {
    if (this.elapsed >= 30) return
    this.elapsed += delta
    const t = Math.min(this.elapsed / 30, 1)
    this.message.alpha = t
    this.message.scale.set(0.4 + t * 0.6)
  }

  private onLobbyState(payload: LobbyStatePayload): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)

    if (payload.status === 'waiting') {
      // Server reset the room — back to lobby for everyone. We pass the lobby
      // payload as scene params so GameScene.onEnter can render the right
      // count immediately, without racing against a fresh `lobby-state` event
      // that may never come (everyone is already connected).
      void this.game.sceneManager.goTo(new GameScene(this.game), {
        initialLobby: payload,
      })
      return
    }

    // status === 'ended': show the right control depending on host.
    if (this.replayBtn || this.hint) return
    if (isHost) {
      const btn = new Button({
        label: 'Rejouer',
        onClick: () => this.game.net.emit('replay'),
      })
      btn.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
      this.addChild(btn)
      this.replayBtn = btn
    } else {
      const hint = new Text({
        text: "En attente d'une nouvelle partie…",
        style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
      })
      hint.anchor.set(0.5)
      hint.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
      this.addChild(hint)
      this.hint = hint
    }
  }
}
```

Why we listen for `lobby-state` here: the server emits one immediately after a successful `replay`. When all clients receive `status === 'waiting'`, they jump back to `GameScene`, which re-enters lobby mode and shows the waiting overlay.

Also: when `EndScene` is entered, the most recent `lobby-state` (sent right after `game-ended`) carries `status === 'ended'`, which is the trigger to render the host-only Replay button. Because Socket.IO does not replay missed events, the gateway in step 7.5 already broadcasts `lobby-state` after `game-ended`, so this works.

- [ ] **Step 8.8: Run server tests + typecheck**

Run:

```bash
pnpm --filter server test
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 8.9: Manual disconnect demo**

Two tabs, start game.

Expected (disconnect):

- Close tab 2 mid-walk → tab 1 sees that zombie disappear cleanly.
- Console: tab 1 logs `[net] connected ...` only (no errors).

Expected (replay):

- Drive tab 1 across the line → both tabs land on EndScene.
- Tab 1 sees "Gagné" and a "Rejouer" button.
- Tab 2 sees "Perdu" and "En attente d'une nouvelle partie…".
- Tab 1 clicks Rejouer → both tabs return to the waiting overlay in `GameScene`.
- Tab 1 starts a new game → both tabs enter the running state again.

- [ ] **Step 8.10: Commit**

```bash
git add apps/server/src/game/ apps/client/src/scenes/EndScene.ts apps/client/src/scenes/GameScene.ts
git commit -m "feat(net): disconnect cleanup + host-driven replay"
```

---

## Final verification

- [ ] **Step F.1: Run the full suite**

Run:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

Expected: all green. If lint fails, address the warnings (most likely: unused imports in `GameScene.ts` from removed sandbox code).

- [ ] **Step F.2: Eight-step demo walkthrough**

Run server + client. Open two tabs. Walk through every roadmap step demo from the spec:

1. Connection logs visible.
2. Lobby state shows accurate count + host promotion.
3. Game start synchronizes initial spawn.
4. Movement is server-driven, both tabs see each other.
5. Shoot+hit produces death animation on both tabs.
6. Win triggers EndScene on both.
7. Replay returns everyone to lobby.
8. Disconnect during game cleans up.

- [ ] **Step F.3: Commit any final cleanup**

If anything was tweaked during the walkthrough (lint fixes, leftover dead code), commit it now:

```bash
git status
git add .
git commit -m "chore(net): cleanup after MVP multiplayer walkthrough"
```
