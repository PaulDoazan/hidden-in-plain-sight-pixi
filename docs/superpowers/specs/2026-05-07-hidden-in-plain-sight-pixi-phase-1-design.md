# Hidden in Plain Sight — Pixi Rewrite, Phase 1 Design

**Date:** 2026-05-07
**Author:** brainstorming session, Paul Doazan
**Status:** Draft for review

## Context

The existing project `hidden-in-plain-sight` (working title in-game: *« Marche ou crève »*) is a 2-player browser game written in CreateJS with vanilla JavaScript modules. Players each control one zombie hidden among bots and try to win without being spotted/shot. The codebase has known incomplete features (see `wip.md`) and uses a legacy library.

This document specifies **Phase 1** of a complete rewrite of the project on a modern stack:

- **PixiJS v8** for rendering
- **TypeScript** for type safety
- **Vite** for the client build
- **Monorepo** structure with **pnpm workspaces** + **Docker Compose** to host the future backend
- **NestJS** scaffold (placeholder only in Phase 1)

Phases 2 and 3 are out of scope for this spec but are referenced where they impact Phase 1 design choices.

## Phasing

| Phase | Scope | This spec |
|-------|-------|-----------|
| **Phase 1** | Frontend Pixi v8 + TS + Vite. Solo sandbox: 1 human player + N bots, mouse aim + click shoot, walk/run keys, arrival line victory. Monorepo + NestJS scaffold (empty) + Docker Compose ready. | **Yes** |
| Phase 2 | Backend NestJS + WebSocket gateway, room codes, multiplayer up to 12 players, hosting. | No (future spec) |
| Phase 3 | Mobile / touch version, responsive controls. | No (future spec) |

## Goals (Phase 1)

1. Set up a clean, scalable monorepo (`apps/client`, `apps/server`, `packages/shared`) usable in the next two phases without re-shuffling.
2. Reproduce and improve the core gameplay of the original game in a solo sandbox: a single human player can move a hidden zombie, aim with the mouse, fire one bullet, and reach the arrival line for victory.
3. Validate every gameplay mechanic that will be reused in the multiplayer phase: walk/run, animations (walk/idle/die/run), aiming, hit detection, win flow, layout responsiveness.
4. Ship a fullscreen canvas with a smartphone-landscape playable area, anticipating the Phase 3 mobile port.

## Non-goals (Phase 1)

- No networking (server stays a hello-world placeholder).
- No multiplayer / lobby / room codes.
- No AI opponent.
- No audio.
- No mobile / touch input.
- No CI / pre-commit hooks.
- No new artwork: assets are reused from the existing project.

## Locked decisions

| Topic | Decision |
|-------|---------|
| New repo path | `/Users/pauldoazan/Projets/Perso/hidden-in-plain-sight-pixi/` |
| Repo structure | Monorepo, pnpm workspaces |
| Node version | 22 LTS (`.nvmrc`) |
| Package manager | pnpm |
| Client build | Vite + TypeScript (strict) |
| Rendering | PixiJS v8 |
| Backend (Phase 1) | NestJS scaffold, hello-world only, not consumed by client |
| Containers | `docker-compose.yml` defines `client` + `server`, ready for Phase 2 |
| Assets | Copy `assets/` from the original repo into `apps/client/public/assets/` |
| Architecture | OOP: classes extending `PIXI.Container`, scenes orchestrated by a `SceneManager` |
| Audio | None |
| Game mode | Solo sandbox: 1 human + bots |
| Win condition | Player crosses the arrival line on the right |
| Lose condition | None in solo |
| Bullets per player | 1 |
| Walk speed | 0.5 px/frame (constant) |
| Run speed | 1.2 px/frame (constant) |
| Controls | Mouse position = crosshair ; Left click = shoot ; Space (hold) = walk ; Shift+Space (hold) = run |
| Canvas | Fullscreen (window.innerWidth × innerHeight) |
| Play area | Centered rectangle, ratio 19.5:9 (smartphone landscape) |
| Background | Tall image, fills the canvas; entities clipped to the play area |

## Repo structure

```
hidden-in-plain-sight-pixi/
├── .gitignore
├── .editorconfig
├── .nvmrc
├── .prettierrc
├── eslint.config.js
├── package.json                # pnpm workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docker-compose.yml
├── README.md
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-07-hidden-in-plain-sight-pixi-phase-1-design.md  (this file, copied here)
│
├── apps/
│   ├── client/
│   │   ├── public/
│   │   │   └── assets/         # copied verbatim from the original project
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app/
│   │   │   │   ├── Game.ts
│   │   │   │   └── SceneManager.ts
│   │   │   ├── scenes/
│   │   │   │   ├── Scene.ts                  # abstract
│   │   │   │   ├── HomeScene.ts
│   │   │   │   ├── LoadingScene.ts
│   │   │   │   ├── GameScene.ts
│   │   │   │   └── EndScene.ts
│   │   │   ├── entities/
│   │   │   │   ├── Zombie.ts                 # abstract
│   │   │   │   ├── Bot.ts
│   │   │   │   ├── PlayerZombie.ts
│   │   │   │   ├── Crosshair.ts
│   │   │   │   ├── Bullet.ts
│   │   │   │   └── BloodSplat.ts
│   │   │   ├── systems/
│   │   │   │   ├── InputManager.ts
│   │   │   │   ├── AssetLoader.ts
│   │   │   │   ├── Layout.ts
│   │   │   │   └── CollisionDetector.ts
│   │   │   ├── ui/
│   │   │   │   ├── Button.ts
│   │   │   │   ├── ProgressBar.ts
│   │   │   │   └── HelpOverlay.ts
│   │   │   ├── config/
│   │   │   │   ├── gameConfig.ts
│   │   │   │   └── manifest.ts
│   │   │   └── types/
│   │   │       └── index.ts
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   └── server/
│       ├── src/
│       │   ├── main.ts
│       │   └── app.module.ts
│       ├── tsconfig.json
│       ├── nest-cli.json
│       ├── package.json
│       └── Dockerfile
│
└── packages/
    └── shared/
        ├── src/
        │   └── index.ts
        ├── tsconfig.json
        └── package.json
```

`packages/shared` is referenced via `workspace:*` in both apps. Phase 1 it only holds gameplay types; Phase 2 will add socket event types.

## Architecture

### Layering

The client uses a strict bottom-up dependency rule. Each layer may depend only on lower layers.

```
main.ts
   |
   v
app/        Game (singleton), SceneManager
   |
   v
scenes/     HomeScene | LoadingScene | GameScene | EndScene
   |
   v
entities/   Zombie | Bot | PlayerZombie | Crosshair | Bullet | BloodSplat
   |
   v
systems/    InputManager | AssetLoader | Layout | CollisionDetector
   |
   v
ui/         Button | ProgressBar | HelpOverlay
```

### Key classes

#### `Game` (`app/Game.ts`)

Singleton holding:
- `pixi: PIXI.Application` (initialised in `main.ts`)
- `sceneManager: SceneManager`
- `input: InputManager`
- `assets: AssetLoader`
- `layout: Layout`

Exposes `update(delta)` which is wired to `pixi.ticker`.

#### `SceneManager` (`app/SceneManager.ts`)

```ts
class SceneManager {
  current: Scene | null
  goTo(SceneClass, params?): void   // calls onExit() on current, onEnter(params) on next
  update(delta: number): void       // forwards to current.update
  resize(layout: Layout): void
}
```

#### `Scene` (`scenes/Scene.ts`)

Abstract base extending `PIXI.Container`:

```ts
abstract class Scene extends PIXI.Container {
  abstract onEnter(params?: unknown): void | Promise<void>
  abstract onExit(): void
  abstract update(delta: number): void
  resize(layout: Layout): void { /* default no-op */ }
}
```

#### Entities

All entities extend `PIXI.Container`. Each owns its sub-sprites and exposes an `update(delta)` method called by `GameScene`.

- **`Zombie` (abstract)**: holds 4 `PIXI.AnimatedSprite` instances (walk, idle, die, run), only one visible at a time. `playAnimation(name)` switches the visible one and starts/stops playback. Stores `aabb` (bounding box) used for hit detection.
- **`Bot extends Zombie`**: in `update(delta)` runs a state machine — `countTick` decreases each frame; on zero, randomly toggles between walk and idle for a new random duration (port of original behavior, `minTick=40`, `maxTick=200`). When walking, increments `x` by `walkSpeed`. Never runs.
- **`PlayerZombie extends Zombie`**: in `update(delta)` reads `Game.input`. If `Space` held → animation `walk`, `x += walkSpeed`. If `Shift+Space` held → animation `run`, `x += runSpeed`. Otherwise → `idle`.
- **`Crosshair extends PIXI.Container`**: drawn with `PIXI.Graphics` (concentric circles + tick marks, port of `target.js`). In `update`, sets `(x,y)` to the latest pointer position from `InputManager`.
- **`Bullet`** (logical, not a long-lived entity): a function `fire(crosshair, zombies)` invoked once per click, while a bullet remains. Looks up the nearest zombie within `crosshair.radius` via `CollisionDetector`. If found, plays a `BloodSplat` at the impact point, sets the target's animation to `die`, and removes it from the bot pool. **The bullet is consumed on click regardless of whether anything is hit** (`bulletsRemaining` goes from 1 to 0). Subsequent clicks are no-ops in Phase 1.
- **`BloodSplat extends PIXI.Container`**: contains an `AnimatedSprite` of the blood spritesheet. Auto-detached and destroyed at end of animation.

### Game loop

```
PIXI.Ticker.shared (60 FPS)
   |
   v
Game.update(delta)
   |
   v
SceneManager.update(delta)
   |
   v
GameScene.update(delta):
   1. for each entity in entities: entity.update(delta)
   2. crosshair.update(delta)
   3. check victory: if playerZombie.x >= layout.arrivalLineX → goTo(EndScene, { won: true })
```

Pixi auto-renders after each tick.

### `InputManager`

Single instance owned by `Game`. Maintains:
- `keys: Set<string>` — keyboard state (keydown adds, keyup removes)
- `pointer: { x: number, y: number }` — mouse position in canvas coordinates
- `firedThisFrame: boolean` — set on click, consumed by `GameScene` once per frame

Methods: `isDown(key)`, `consumeFire(): boolean`.

### `Layout`

Computes the play area and exposes positional constants. Recomputed on `window.resize`.

```ts
class Layout {
  canvasWidth: number
  canvasHeight: number
  playArea: { x: number, y: number, width: number, height: number }
  arrivalLineX: number          // playArea.x + playArea.width - margin

  recompute(window): void
}
```

Computation rule: `playArea` is centered, fills the screen as much as possible while keeping `width / height = 19.5 / 9`. If window is wider than that ratio, height = window height (minus padding) and width is derived; otherwise width = window width and height is derived.

The background sprite covers the whole canvas. Entities are positioned and clipped to `playArea` (we use a `PIXI.Container` mask on the game container).

### `CollisionDetector`

Pure functions:

```ts
findNearestZombieWithin(point, zombies, radius): Zombie | null
isPointInAABB(point, aabb): boolean
```

For Phase 1 we use point-vs-AABB (point = crosshair center, AABB = zombie bounding box). The `wip.md` calls out that the original distance-vs-radius check is too coarse — we fix this here.

### Scenes detail

#### `HomeScene`
- Background image (one of the existing bgs or a static title screen) + game title
- "Jouer" button → `LoadingScene`
- "Aide" button → opens `HelpOverlay` (modal-style overlay over the scene)

#### `LoadingScene`
- `AssetLoader.loadAll()` returns a promise; progress callback updates a `ProgressBar`
- On complete → `GameScene`

#### `GameScene`
- Onenter:
  - Builds the world: `bg1` container behind, `bg2` container in front (parallax, like original)
  - Spawns `numBots` (default 20) at randomized positions in `playArea`'s left half (x ∈ [playArea.x, playArea.x + playArea.width / 2], y ∈ [playArea.y, playArea.y + playArea.height])
  - Spawns 1 `PlayerZombie` at the far left of `playArea` (x = playArea.x + 30, y = playArea.y + playArea.height / 2)
  - Spawns 1 `Crosshair`, default at the center of `playArea`
  - Draws the arrival line: a vertical dashed line at `layout.arrivalLineX`
  - Listens for click on stage; calls `Bullet.fire(...)` if `bulletsRemaining > 0`, then decrements `bulletsRemaining` regardless of hit
- `update(delta)`: per the loop above
- `onExit`: removes listeners, destroys entities

#### `EndScene`
- Receives `{ won: boolean }` (Phase 1 always true since no lose condition)
- Centered "Gagné !" text with fade-in + scale-up animation
- "Rejouer" button → `GameScene`

## Shared types (`packages/shared`)

```ts
// packages/shared/src/index.ts

export type ZombieType = 'man' | 'woman' | 'wild'
export type ZombieAnimation = 'walk' | 'idle' | 'die' | 'run'

export interface GameConfig {
  numBots: number          // default Phase 1: 20
  walkSpeed: number        // px/frame, default 0.5
  runSpeed: number         // px/frame, default 1.2
  bulletsPerPlayer: number // default 1
  playAreaRatio: number    // default 19.5/9
}

export interface ZombieState {
  id: string
  type: ZombieType
  x: number
  y: number
  animation: ZombieAnimation
  isAlive: boolean
}
```

These types are imported by both apps. `apps/client` also defines a `defaultGameConfig` constant.

## Tooling

- **TypeScript 5.x**, `strict: true`, `noUncheckedIndexedAccess: true`
- **ESLint v9 (flat config)** with `@typescript-eslint`, `eslint-plugin-import`
- **Prettier**: single quote, no semicolons, trailing comma all
- **EditorConfig**: 2-space indent, LF, UTF-8
- **Vitest** in `apps/client` for utility/system unit tests (`Layout`, `CollisionDetector`)
- **Jest** in `apps/server` (NestJS default), nearly empty
- **No Husky / no CI** in Phase 1

### Root scripts

```json
{
  "scripts": {
    "dev": "pnpm --parallel --filter './apps/*' dev",
    "dev:client": "pnpm --filter client dev",
    "dev:server": "pnpm --filter server start:dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  }
}
```

## Docker Compose (Phase 1)

`docker-compose.yml` defines `client` and `server` services, both with multi-stage `Dockerfile`s (`base`, `dev`, `build`, `prod`) using Corepack-enabled `pnpm`. `target: dev` mounts source for live reload. Phase 1 dev workflow can use plain `pnpm dev`; Compose is ready for Phase 2 when the server starts being consumed.

```yaml
services:
  client:
    build:
      context: .
      dockerfile: apps/client/Dockerfile
      target: dev
    ports: ["5173:5173"]
    volumes:
      - ./apps/client:/app/apps/client
      - ./packages/shared:/app/packages/shared
      - /app/node_modules
    command: pnpm --filter client dev --host

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
      target: dev
    ports: ["3000:3000"]
    volumes:
      - ./apps/server:/app/apps/server
      - ./packages/shared:/app/packages/shared
      - /app/node_modules
    command: pnpm --filter server start:dev
```

## Asset migration

Source: `/Users/pauldoazan/Projets/Perso/hidden-in-plain-sight/assets/`

The implementation copies the entire folder verbatim into `apps/client/public/assets/`. Pixi v8 `Assets.load()` handles both PNG and the per-zombie spritesheets directly (no JSON-driven manifest needed; we describe each spritesheet inline using frame counts from `spriteSheetInfos.json`). The `Run.png` for each type, unused in the original, is added to the manifest in the new project.

`apps/client/src/config/manifest.ts` exposes a typed list of every asset the client needs; `AssetLoader` consumes it.

## Testing strategy

| Concern | Approach |
|---------|----------|
| `Layout.recompute` | Unit (Vitest): given `(windowW, windowH, ratio)`, expected play area |
| `CollisionDetector.findNearestZombieWithin` | Unit (Vitest): seeded zombies, varying crosshair positions |
| Bot state machine | Unit (Vitest): inject a deterministic RNG, assert transitions over N ticks |
| Pixi rendering | Not tested in Phase 1 |
| Scenes | Manually validated in browser |
| End-to-end | Out of scope; Phase 2 will add Playwright |

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Pixi v8 has a different Assets API than v7; tutorials may mislead | Reference the official v8 docs (`pixijs.com/8.x`) and the official `Assets.load()` examples; pin Pixi version in `package.json` |
| Spritesheet frame counts in `spriteSheetInfos.json` may be off-by-one (see `e576399`-era fixes) | Re-verify each frame count by visual inspection of the PNG widths during implementation |
| Fullscreen canvas + DPR scaling can blur sprites | Use `PIXI.Application` with `autoDensity: true`, `resolution: window.devicePixelRatio`, and `roundPixels: true` on sprites |
| Mask on play area might break input coordinates | Convert pointer events from global to local using `event.global` and `toLocal()` in entities |

## Open questions

None. Spec is complete given the current scope.

## Next step

Once approved, the implementation plan will be written via the `superpowers:writing-plans` skill. The plan will:
1. Create the new repo at `/Users/pauldoazan/Projets/Perso/hidden-in-plain-sight-pixi/`
2. Initialize git, monorepo skeleton, tooling
3. Copy this spec into the new repo
4. Implement scenes, entities, systems incrementally
5. Validate in browser
