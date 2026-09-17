# Start-of-round bonus draft — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open every round with a private draft — three bonuses drawn out of six per player, one pick each — and make the six bonuses work in game.

**Architecture:** The room gains a `drafting` status between `waiting` and `running`, and spawning moves from `start()` to the end of the draft so passive bonuses apply to freshly spawned players. Bonus effects live in a declarative registry (`bonuses.ts`) exposing three hooks — `onRoundStart`, `onActivate`, `onLethalHit` — that `GameRoomService` calls at exactly three points; the service never names a bonus. The draw and pick bookkeeping live in their own class (`BonusDraft`). The client gets a draft overlay, a trigger key/button for active bonuses, and a HUD indicator.

**Tech Stack:** TypeScript monorepo (pnpm workspaces). Server: NestJS + socket.io, tests with Jest (`pnpm --filter server test`). Client: Pixi.js v8 + Vite, tests with Vitest (`pnpm --filter client test`). Shared types: `packages/shared` (single file, CommonJS-friendly — see the comment at the top of `index.ts` before splitting it).

**Spec:** `docs/superpowers/specs/2026-09-17-bonus-draft-design.md`

## Global Constraints

- The picked bonus is **never** put on `PlayerState`: it would leak to every client in each 30 Hz snapshot. Clients learn their own bonus from their own pick and learn a spent charge from `bonus-used`.
- `bonus-used` has two audiences: the owner always receives it, the rest of the room only when the bonus is revealed (`bomb`, `vest`).
- All user-facing copy is French; all code, comments and docs are English. Existing style: `Space Mono, monospace`, yellow `0xfff700`, dark panel `0x1f2937`.
- Catalogue, ids and tuning are fixed: `bomb`, `extra-life`, `vest`, `skin-swap`, `magazine`, `sprint`; offer size 3; draft duration 15 000 ms; bomb ratio 0.2 (min 1); sprint multiplier 1.35; magazine +1 bullet; every charged bonus has exactly 1 charge.
- Run `pnpm typecheck` and `pnpm --filter server test` before each commit. The repo has a husky/lint-staged pre-commit hook that runs eslint and a full typecheck — a commit that fails either is rejected.
- Client has no UI test infrastructure (only `apps/client/src/systems/__tests__`). Client tasks are verified by typecheck, lint and a manual browser pass.

---

### Task 1: Shared protocol and catalogue

**Files:**

- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `BonusId`, `BonusKind`, `BonusInfo`, `BONUS_INFO`, `BONUS_IDS`, `BONUS_OFFER_SIZE`, `DRAFT_DURATION_MS`, `BonusDraftStartedPayload`, `BonusDraftProgressPayload`, `PickBonusPayload`, `BonusUsedPayload`, and the `'drafting'` member of `RoomStatus`. Every later task imports from here.

- [ ] **Step 1: Add the bonus catalogue after the `RoomStatus` declaration**

Add `'drafting'` to `RoomStatus` first:

```ts
export type RoomStatus = 'waiting' | 'drafting' | 'running' | 'ended'
```

Then append the catalogue block right after it:

```ts
// ─── Bonuses ──────────────────────────────────────────────────────────────

export type BonusId = 'bomb' | 'extra-life' | 'vest' | 'skin-swap' | 'magazine' | 'sprint'

// 'active' bonuses are triggered by the player (B key / mobile button);
// 'passive' ones fire on their own (at spawn, or when the player is hit).
export type BonusKind = 'passive' | 'active'

export interface BonusInfo {
  id: BonusId
  name: string
  description: string
  icon: string
  kind: BonusKind
  // Kill-feed sentence used when the bonus is revealed to the whole room.
  // Absent for bonuses that stay silent.
  usedMessage?: string
}

// Presentation metadata lives in shared so the client can render draft cards,
// HUD icons and banners without keeping its own copy of the catalogue in sync.
export const BONUS_INFO: Record<BonusId, BonusInfo> = {
  bomb: {
    id: 'bomb',
    name: 'Bombe',
    description: 'À déclencher quand tu veux : tue 20 % des faux zombies.',
    icon: '💣',
    kind: 'active',
    usedMessage: 'a lâché une bombe',
  },
  'extra-life': {
    id: 'extra-life',
    name: 'Seconde vie',
    description: 'À ta mort, tu ressuscites dans le corps d’un autre zombie.',
    icon: '❤️',
    kind: 'passive',
  },
  vest: {
    id: 'vest',
    name: 'Gilet',
    description: 'Le premier tir qui te touche ne te tue pas.',
    icon: '🛡️',
    kind: 'passive',
    usedMessage: 'a encaissé le tir',
  },
  'skin-swap': {
    id: 'skin-swap',
    name: 'Changement de peau',
    description: 'À déclencher : tu prends la place et l’apparence d’un autre zombie.',
    icon: '🎭',
    kind: 'active',
  },
  magazine: {
    id: 'magazine',
    name: 'Chargeur',
    description: 'Tu démarres la manche avec une balle de plus.',
    icon: '🔫',
    kind: 'passive',
  },
  sprint: {
    id: 'sprint',
    name: 'Sprint',
    description: 'Tu cours 35 % plus vite.',
    icon: '👟',
    kind: 'passive',
  },
}

// Draw order is the declaration order above; tests rely on it.
export const BONUS_IDS = Object.keys(BONUS_INFO) as BonusId[]

// Cards offered to each player at the start of a round, and how long they
// have to pick before the server picks for them.
export const BONUS_OFFER_SIZE = 3
export const DRAFT_DURATION_MS = 15_000
```

- [ ] **Step 2: Add the payloads next to the other socket payloads**

Put these right after `PlayerLeftPayload`:

```ts
// Sent socket by socket: each player learns only its own three cards.
export interface BonusDraftStartedPayload {
  offer: BonusId[]
  durationMs: number
}

// Broadcast: who has already picked, never what they picked.
export interface BonusDraftProgressPayload {
  pickedIds: string[]
}

export interface PickBonusPayload {
  bonusId: BonusId
}

// Always sent to the owner (their HUD needs to know the charge is spent);
// broadcast to the rest of the room only for a revealed bonus.
export interface BonusUsedPayload {
  playerId: string
  username: string
  bonusId: BonusId
}
```

- [ ] **Step 3: Extend the event maps**

In `ClientToServerEvents`:

```ts
  'pick-bonus': (payload: PickBonusPayload) => void
  'use-bonus': () => void
```

In `ServerToClientEvents`:

```ts
  'bonus-draft-started': (payload: BonusDraftStartedPayload) => void
  'bonus-draft-progress': (payload: BonusDraftProgressPayload) => void
  'bonus-used': (payload: BonusUsedPayload) => void
```

- [ ] **Step 4: Verify it compiles across the workspace**

Run: `pnpm --filter @hips/shared build && pnpm typecheck`
Expected: PASS, no errors. (The shared package must be built before the other two typecheck against it.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add the bonus catalogue and draft protocol"
```

---

### Task 2: Internal room state and the draft draw

**Files:**

- Create: `apps/server/src/game/room-state.ts`
- Create: `apps/server/src/game/bonus-draft.ts`
- Create: `apps/server/src/game/bonus-draft.spec.ts`
- Modify: `apps/server/src/game/game-room.service.ts` (remove the local `BotInternalState`, import it instead)

**Interfaces:**

- Consumes: `BonusId`, `BONUS_IDS`, `BONUS_OFFER_SIZE` from Task 1.
- Produces: `PlayerInternalState`, `BotInternalState` (from `room-state.ts`); `BonusDraft` with `offerFor`, `entries`, `pick`, `pickedIds`, `isComplete`, `forget`, `resolve`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/game/bonus-draft.spec.ts`:

```ts
import { BONUS_IDS, BONUS_OFFER_SIZE } from '@hips/shared'

import { BonusDraft } from './bonus-draft'

// Always-zero RNG: every draw takes the first remaining card, so an offer is
// deterministically the first three ids in BONUS_IDS order.
const zeroRng = () => 0

describe('BonusDraft', () => {
  it('offers three distinct bonuses per player', () => {
    const draft = new BonusDraft(['a', 'b'], Math.random)
    for (const id of ['a', 'b']) {
      const offer = draft.offerFor(id)!
      expect(offer).toHaveLength(BONUS_OFFER_SIZE)
      expect(new Set(offer).size).toBe(BONUS_OFFER_SIZE)
      for (const bonus of offer) expect(BONUS_IDS).toContain(bonus)
    }
  })

  it('draws from the catalogue in order under a zero RNG', () => {
    const draft = new BonusDraft(['a'], zeroRng)
    expect(draft.offerFor('a')).toEqual(BONUS_IDS.slice(0, BONUS_OFFER_SIZE))
  })

  it('returns null for a player that is not in the draft', () => {
    const draft = new BonusDraft(['a'], zeroRng)
    expect(draft.offerFor('ghost')).toBeNull()
  })

  it('rejects a bonus that was not offered', () => {
    const draft = new BonusDraft(['a'], zeroRng)
    const notOffered = BONUS_IDS[BONUS_IDS.length - 1]!
    expect(draft.pick('a', notOffered)).toBe(false)
    expect(draft.pickedIds()).toEqual([])
  })

  it('rejects a second pick from the same player', () => {
    const draft = new BonusDraft(['a'], zeroRng)
    const offer = draft.offerFor('a')!
    expect(draft.pick('a', offer[0]!)).toBe(true)
    expect(draft.pick('a', offer[1]!)).toBe(false)
  })

  it('is complete only once every player has picked', () => {
    const draft = new BonusDraft(['a', 'b'], zeroRng)
    draft.pick('a', draft.offerFor('a')![0]!)
    expect(draft.isComplete()).toBe(false)
    draft.pick('b', draft.offerFor('b')![0]!)
    expect(draft.isComplete()).toBe(true)
  })

  it('auto-picks a card from the offer for a player who never picked', () => {
    const draft = new BonusDraft(['a', 'b'], zeroRng)
    const chosen = draft.offerFor('a')![2]!
    draft.pick('a', chosen)
    const picks = draft.resolve()
    expect(picks.get('a')).toBe(chosen)
    expect(draft.offerFor('b')).toContain(picks.get('b'))
  })

  it('forgets a disconnected player, unblocking completion', () => {
    const draft = new BonusDraft(['a', 'b'], zeroRng)
    draft.pick('a', draft.offerFor('a')![0]!)
    expect(draft.isComplete()).toBe(false)
    draft.forget('b')
    expect(draft.isComplete()).toBe(true)
    expect(draft.offerFor('b')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server test -- bonus-draft`
Expected: FAIL — `Cannot find module './bonus-draft'`.

- [ ] **Step 3: Create `room-state.ts`**

```ts
import type { BonusId, BotState, PlayerState } from '@hips/shared'

// Server-side player record. Everything beyond PlayerState is private to the
// room and stripped before a snapshot goes out: the drafted bonus must never
// reach other clients (that is the whole point of a secret pick).
export interface PlayerInternalState extends PlayerState {
  bonus: BonusId | null
  // Remaining uses. 1 for a bonus with an onActivate or onLethalHit hook,
  // 0 for a purely passive one.
  bonusCharges: number
  // Run-speed factor applied in tick(). 1 unless the Sprint bonus raised it.
  runMultiplier: number
}

// Bots wander on a timer; neither field belongs in a client snapshot.
export interface BotInternalState extends BotState {
  canMove: boolean
  countTick: number
}
```

- [ ] **Step 4: Create `bonus-draft.ts`**

```ts
import type { BonusId } from '@hips/shared'
import { BONUS_IDS, BONUS_OFFER_SIZE } from '@hips/shared'

// Owns one round's draw: which cards each player was offered and what they
// picked. Independent of the room so it can be unit-tested on its own, and so
// GameRoomService keeps a single field instead of three maps.
export class BonusDraft {
  private readonly offers = new Map<string, BonusId[]>()
  private readonly picks = new Map<string, BonusId>()

  constructor(
    playerIds: string[],
    private readonly rng: () => number,
  ) {
    for (const id of playerIds) this.offers.set(id, this.drawOffer())
  }

  offerFor(playerId: string): BonusId[] | null {
    const offer = this.offers.get(playerId)
    return offer ? [...offer] : null
  }

  // Every offer, for the gateway to emit socket by socket.
  entries(): { playerId: string; offer: BonusId[] }[] {
    return [...this.offers].map(([playerId, offer]) => ({
      playerId,
      offer: [...offer],
    }))
  }

  // Rejects a bonus outside the player's own offer and any second pick, so a
  // hostile client can't draft a card it was never shown or swap later.
  pick(playerId: string, bonusId: BonusId): boolean {
    if (this.picks.has(playerId)) return false
    const offer = this.offers.get(playerId)
    if (!offer?.includes(bonusId)) return false
    this.picks.set(playerId, bonusId)
    return true
  }

  pickedIds(): string[] {
    return [...this.picks.keys()]
  }

  isComplete(): boolean {
    return this.picks.size === this.offers.size
  }

  forget(playerId: string): void {
    this.offers.delete(playerId)
    this.picks.delete(playerId)
  }

  // Closes the draft. Stragglers get a random card among the three they were
  // offered — not the first, which would make one bonus over-represented
  // every time a player goes AFK.
  resolve(): Map<string, BonusId> {
    for (const [playerId, offer] of this.offers) {
      if (this.picks.has(playerId)) continue
      this.picks.set(playerId, offer[Math.floor(this.rng() * offer.length)]!)
    }
    return new Map(this.picks)
  }

  // Draw without replacement so the three cards are always distinct. Offers
  // are independent between players: two players may be shown, and pick, the
  // same bonus.
  private drawOffer(): BonusId[] {
    const pool = [...BONUS_IDS]
    const offer: BonusId[] = []
    for (let i = 0; i < BONUS_OFFER_SIZE && pool.length > 0; i++) {
      offer.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!)
    }
    return offer
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter server test -- bonus-draft`
Expected: PASS, 8 tests.

- [ ] **Step 6: Move `BotInternalState` out of the service**

In `apps/server/src/game/game-room.service.ts`, delete the local declaration:

```ts
interface BotInternalState extends BotState {
  canMove: boolean
  countTick: number
}
```

and import it instead, next to the other local imports:

```ts
import type { BotInternalState } from './room-state'
```

- [ ] **Step 7: Verify nothing broke**

Run: `pnpm --filter server test && pnpm typecheck`
Expected: PASS, the whole existing suite still green.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/game/room-state.ts apps/server/src/game/bonus-draft.ts apps/server/src/game/bonus-draft.spec.ts apps/server/src/game/game-room.service.ts
git commit -m "feat(server): draw three bonus cards per player each round"
```

---

### Task 3: The bonus registry

**Files:**

- Create: `apps/server/src/game/bonuses.ts`
- Create: `apps/server/src/game/bonuses.spec.ts`

**Interfaces:**

- Consumes: `PlayerInternalState`, `BotInternalState` (Task 2); `BonusId`, `BonusKind` (Task 1).
- Produces: `BonusContext`, `ActivateOutcome`, `LethalHitOutcome`, `BonusDefinition`, `BONUS_REGISTRY`, `BOMB_BOT_KILL_RATIO`, `SPRINT_RUN_MULTIPLIER`, `MAGAZINE_EXTRA_BULLETS`. Task 4 and Task 5 call the hooks through `BONUS_REGISTRY`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/game/bonuses.spec.ts`:

```ts
import type { BonusId } from '@hips/shared'

import { BONUS_REGISTRY, BOMB_BOT_KILL_RATIO, type BonusContext } from './bonuses'
import type { BotInternalState, PlayerInternalState } from './room-state'

function makePlayer(over: Partial<PlayerInternalState> = {}): PlayerInternalState {
  return {
    id: 'a',
    type: 'man',
    x: 100,
    y: 500,
    animation: 'idle',
    isAlive: true,
    bulletsRemaining: 1,
    color: 0xff5252,
    pointer: { x: 0, y: 0 },
    username: 'Antoine',
    bonus: null,
    bonusCharges: 0,
    runMultiplier: 1,
    ...over,
  }
}

function makeBots(count: number): BotInternalState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot-${i}`,
    type: 'woman' as const,
    x: 200 + i,
    y: 400 + i,
    animation: 'idle' as const,
    isAlive: true,
    canMove: false,
    countTick: 10,
  }))
}

function makeCtx(
  player: PlayerInternalState,
  bots: BotInternalState[],
  rng = () => 0,
): BonusContext {
  return {
    player,
    aliveBots: () => bots.filter((b) => b.isAlive),
    rng,
  }
}

describe('bonus registry — passive spawn effects', () => {
  it('magazine adds one bullet at spawn', () => {
    const player = makePlayer({ bulletsRemaining: 1 })
    BONUS_REGISTRY.magazine.onRoundStart!(makeCtx(player, []))
    expect(player.bulletsRemaining).toBe(2)
  })

  it('sprint raises the run multiplier', () => {
    const player = makePlayer()
    BONUS_REGISTRY.sprint.onRoundStart!(makeCtx(player, []))
    expect(player.runMultiplier).toBeGreaterThan(1)
  })
})

describe('bonus registry — bomb', () => {
  it('kills a fifth of the living bots, rounded up', () => {
    const bots = makeBots(20)
    const outcome = BONUS_REGISTRY.bomb.onActivate!(makeCtx(makePlayer(), bots))
    expect(outcome).toEqual({ reveal: true })
    const dead = bots.filter((b) => !b.isAlive)
    expect(dead).toHaveLength(Math.ceil(20 * BOMB_BOT_KILL_RATIO))
    for (const b of dead) expect(b.animation).toBe('die')
  })

  it('always kills at least one bot', () => {
    const bots = makeBots(2)
    BONUS_REGISTRY.bomb.onActivate!(makeCtx(makePlayer(), bots))
    expect(bots.filter((b) => !b.isAlive)).toHaveLength(1)
  })

  it('refuses to fire when no bot is alive, so the charge is kept', () => {
    expect(BONUS_REGISTRY.bomb.onActivate!(makeCtx(makePlayer(), []))).toBeNull()
  })
})

describe('bonus registry — skin swap', () => {
  it('swaps position and appearance with a living bot, both alive', () => {
    const player = makePlayer({ x: 100, y: 500, type: 'man' })
    const bots = makeBots(1)
    const botBefore = { x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }
    const outcome = BONUS_REGISTRY['skin-swap'].onActivate!(makeCtx(player, bots))
    expect(outcome).toEqual({ reveal: false })
    expect({ x: player.x, y: player.y, type: player.type }).toEqual(botBefore)
    expect({ x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }).toEqual({
      x: 100,
      y: 500,
      type: 'man',
    })
    expect(bots[0]!.isAlive).toBe(true)
  })

  it('refuses to fire when no bot is alive', () => {
    expect(BONUS_REGISTRY['skin-swap'].onActivate!(makeCtx(makePlayer(), []))).toBeNull()
  })
})

describe('bonus registry — lethal hit', () => {
  it('the vest absorbs the hit on the spot and is revealed', () => {
    const player = makePlayer({ x: 100, y: 500 })
    const outcome = BONUS_REGISTRY.vest.onLethalHit!(makeCtx(player, makeBots(3)))
    expect(outcome).toEqual({ survived: true, reveal: true })
    expect(player.x).toBe(100)
  })

  it('the extra life swaps with a bot that dies in the player’s place', () => {
    const player = makePlayer({ x: 100, y: 500, type: 'man' })
    const bots = makeBots(3)
    const decoyBefore = { x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }
    const outcome = BONUS_REGISTRY['extra-life'].onLethalHit!(makeCtx(player, bots))
    expect(outcome.survived).toBe(true)
    expect(outcome.reveal).toBe(false)
    expect(outcome.diedInstead).toBe(bots[0])
    expect(bots[0]!.isAlive).toBe(false)
    expect(bots[0]!.animation).toBe('die')
    // The decoy died where the player stood; the player now stands where the
    // decoy was, wearing its appearance.
    expect({ x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }).toEqual({
      x: 100,
      y: 500,
      type: 'man',
    })
    expect({ x: player.x, y: player.y, type: player.type }).toEqual(decoyBefore)
  })

  it('the extra life cannot save a player when no bot is alive', () => {
    const outcome = BONUS_REGISTRY['extra-life'].onLethalHit!(makeCtx(makePlayer(), []))
    expect(outcome).toEqual({ survived: false, reveal: false })
  })
})

describe('bonus registry — shape', () => {
  it('declares a hook for every bonus and matches the shared kinds', () => {
    const ids = Object.keys(BONUS_REGISTRY) as BonusId[]
    for (const id of ids) {
      const def = BONUS_REGISTRY[id]
      const hasHook =
        Boolean(def.onRoundStart) || Boolean(def.onActivate) || Boolean(def.onLethalHit)
      expect(hasHook).toBe(true)
      if (def.kind === 'active') expect(def.onActivate).toBeDefined()
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server test -- bonuses`
Expected: FAIL — `Cannot find module './bonuses'`.

- [ ] **Step 3: Create `bonuses.ts`**

```ts
import type { BonusId, BonusKind } from '@hips/shared'
import { BONUS_INFO } from '@hips/shared'

import type { BotInternalState, PlayerInternalState } from './room-state'

// Share of the living bots a bomb takes out, rounded up, never fewer than one.
export const BOMB_BOT_KILL_RATIO = 0.2
// Sprint only touches running; walking is unchanged.
export const SPRINT_RUN_MULTIPLIER = 1.35
export const MAGAZINE_EXTRA_BULLETS = 1

// What a hook is allowed to see and touch. Everything it needs is passed in,
// so bonuses stay pure functions of the room state and take the room's
// injected RNG — which keeps them deterministic under test.
export interface BonusContext {
  player: PlayerInternalState
  aliveBots: () => BotInternalState[]
  rng: () => number
}

export interface ActivateOutcome {
  // Whether the whole room is told. See the reveal rule in the design doc:
  // a bonus is announced only when somebody would otherwise be confused.
  reveal: boolean
}

export interface LethalHitOutcome {
  survived: boolean
  reveal: boolean
  // Set when the player escaped by swapping with a bot that died in their
  // place. The caller reports that bot as the victim, so the rest of the
  // pipeline sees an ordinary bot kill — which is the illusion the bonus
  // is built on.
  diedInstead?: BotInternalState
}

export interface BonusDefinition {
  id: BonusId
  kind: BonusKind
  // Spawn time, once the player exists.
  onRoundStart?: (ctx: BonusContext) => void
  // The player pressed the trigger. Returning null refuses the activation and
  // keeps the charge (nothing to act on).
  onActivate?: (ctx: BonusContext) => ActivateOutcome | null
  // The player just took a lethal hit, before anything kills them.
  onLethalHit?: (ctx: BonusContext) => LethalHitOutcome
}

// Swaps position and appearance between a player and a bot. Both body-swap
// bonuses are built on it; only what happens to the bot afterwards differs.
function swapBodies(player: PlayerInternalState, bot: BotInternalState): void {
  const { x, y, type } = player
  player.x = bot.x
  player.y = bot.y
  player.type = bot.type
  bot.x = x
  bot.y = y
  bot.type = type
}

function pickRandom<T>(items: T[], rng: () => number): T | null {
  if (items.length === 0) return null
  return items[Math.floor(rng() * items.length)]!
}

export const BONUS_REGISTRY: Record<BonusId, BonusDefinition> = {
  bomb: {
    id: 'bomb',
    kind: BONUS_INFO.bomb.kind,
    onActivate: (ctx) => {
      const bots = ctx.aliveBots()
      if (bots.length === 0) return null
      const count = Math.min(bots.length, Math.max(1, Math.ceil(bots.length * BOMB_BOT_KILL_RATIO)))
      // Partial Fisher-Yates over a copy: an unbiased sample without
      // replacement, so no bot can be picked twice.
      const pool = [...bots]
      for (let i = 0; i < count; i++) {
        const j = i + Math.floor(ctx.rng() * (pool.length - i))
        const tmp = pool[i]!
        pool[i] = pool[j]!
        pool[j] = tmp
        pool[i]!.isAlive = false
        pool[i]!.animation = 'die'
      }
      return { reveal: true }
    },
  },
  'extra-life': {
    id: 'extra-life',
    kind: BONUS_INFO['extra-life'].kind,
    onLethalHit: (ctx) => {
      const decoy = pickRandom(ctx.aliveBots(), ctx.rng)
      // No camouflage left to hide in: the player dies like anyone else.
      if (!decoy) return { survived: false, reveal: false }
      swapBodies(ctx.player, decoy)
      decoy.isAlive = false
      decoy.animation = 'die'
      return { survived: true, reveal: false, diedInstead: decoy }
    },
  },
  vest: {
    id: 'vest',
    kind: BONUS_INFO.vest.kind,
    onLethalHit: () => ({ survived: true, reveal: true }),
  },
  'skin-swap': {
    id: 'skin-swap',
    kind: BONUS_INFO['skin-swap'].kind,
    onActivate: (ctx) => {
      const target = pickRandom(ctx.aliveBots(), ctx.rng)
      if (!target) return null
      swapBodies(ctx.player, target)
      return { reveal: false }
    },
  },
  magazine: {
    id: 'magazine',
    kind: BONUS_INFO.magazine.kind,
    onRoundStart: (ctx) => {
      ctx.player.bulletsRemaining += MAGAZINE_EXTRA_BULLETS
    },
  },
  sprint: {
    id: 'sprint',
    kind: BONUS_INFO.sprint.kind,
    onRoundStart: (ctx) => {
      ctx.player.runMultiplier = SPRINT_RUN_MULTIPLIER
    },
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server test -- bonuses`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/game/bonuses.ts apps/server/src/game/bonuses.spec.ts
git commit -m "feat(server): add the declarative bonus registry"
```

---

### Task 4: Draft lifecycle in the room

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`

**Interfaces:**

- Consumes: `BonusDraft` (Task 2), `BONUS_REGISTRY` (Task 3).
- Produces: `start()` now returns `{ offers: { playerId: string; offer: BonusId[] }[] } | null`; `pickBonus(playerId, bonusId)` → `{ accepted, complete, pickedIds }`; `resolveDraft()` → `GameStartedPayload | null`; `isDrafting()`; `draftComplete()`; `forceBonusForTest(playerId, bonusId)`. Task 6 calls all of them from the gateway.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/game/game-room.service.spec.ts` (and add `BONUS_INFO`, `type BonusId` to the `@hips/shared` import at the top, plus `SPRINT_RUN_MULTIPLIER` from `./bonuses`):

```ts
describe('GameRoomService — draft lifecycle', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
  })

  it('enters drafting and offers cards to every player instead of spawning', () => {
    const result = room.start('a')!
    expect(room.snapshotLobby().status).toBe('drafting')
    expect(result.offers.map((o) => o.playerId).sort()).toEqual(['a', 'b'])
    expect(result.offers[0]!.offer).toHaveLength(3)
    // Nothing exists on the field yet.
    expect(room.snapshotState().players).toEqual([])
    expect(room.snapshotState().bots).toEqual([])
  })

  it('refuses to fire while the draft is open', () => {
    room.start('a')
    expect(room.fire('a', { x: 0, y: 0 })).toBeNull()
  })

  it('rejects a bonus the player was not offered', () => {
    const result = room.start('a')!
    const offer = result.offers.find((o) => o.playerId === 'a')!.offer
    const notOffered = (Object.keys(BONUS_INFO) as BonusId[]).find((id) => !offer.includes(id))!
    expect(room.pickBonus('a', notOffered).accepted).toBe(false)
  })

  it('reports completion once every player has picked', () => {
    const result = room.start('a')!
    const offerOf = (id: string) => result.offers.find((o) => o.playerId === id)!.offer
    expect(room.pickBonus('a', offerOf('a')[0]!)).toEqual({
      accepted: true,
      complete: false,
      pickedIds: ['a'],
    })
    const second = room.pickBonus('b', offerOf('b')[0]!)
    expect(second.complete).toBe(true)
    expect(second.pickedIds.sort()).toEqual(['a', 'b'])
  })

  it('spawns everyone and starts running when the draft resolves', () => {
    room.start('a')
    const started = room.resolveDraft()!
    expect(room.snapshotLobby().status).toBe('running')
    expect(started.players).toHaveLength(2)
    expect(started.bots).toHaveLength(BOT_COUNT)
    // The private bonus fields never leave the server.
    expect(started.players[0]).not.toHaveProperty('bonus')
    expect(room.snapshotState().players[0]).not.toHaveProperty('bonusCharges')
  })

  it('applies a passive bonus at spawn', () => {
    room.start('a')
    room.resolveDraft()
    room.forceBonusForTest('a', 'magazine')
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(
      BULLETS_PER_PLAYER + 1,
    )
  })

  it('makes a sprinting player cover more ground per tick', () => {
    room.start('a')
    room.resolveDraft()
    room.forceBonusForTest('a', 'sprint')
    const before = room.snapshotState().players.find((p) => p.id === 'a')!.x
    room.applyInput('a', {
      keys: { space: true, shift: true },
      pointer: { x: 0, y: 0 },
    })
    room.tick()
    const after = room.snapshotState().players.find((p) => p.id === 'a')!.x
    const tickScale = 60 / SERVER_TICK_HZ
    expect(after - before).toBeCloseTo(RUN_SPEED * tickScale * SPRINT_RUN_MULTIPLIER)
  })

  it('drops the draft when a player leaves and lets the rest finish', () => {
    const result = room.start('a')!
    const offerOf = (id: string) => result.offers.find((o) => o.playerId === id)!.offer
    room.pickBonus('a', offerOf('a')[0]!)
    expect(room.draftComplete()).toBe(false)
    room.removePlayer('b')
    expect(room.draftComplete()).toBe(true)
  })

  it('redraws a draft on the next round', () => {
    room.start('a')
    room.resolveDraft()
    room.teleportForTest('a', ARRIVAL_LINE_X)
    room.tickAndCheckWinner()
    expect(room.replay('a')).toBe(true)
    expect(room.snapshotLobby().status).toBe('waiting')
    expect(room.start('a')!.offers).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server test -- game-room.service`
Expected: FAIL — `room.pickBonus is not a function`, and the existing `start()` tests will also fail because they assume spawning.

- [ ] **Step 3: Split `start()` into draft and spawn**

In `game-room.service.ts`, add the imports and the field:

```ts
import { BONUS_REGISTRY, type BonusContext } from './bonuses'
import { BonusDraft } from './bonus-draft'
import type { BotInternalState, PlayerInternalState } from './room-state'
```

```ts
  private readonly players = new Map<string, PlayerInternalState>()
  // Open draft, or null outside the `drafting` status.
  private draft: BonusDraft | null = null
```

Replace `start()` with:

```ts
  // Opens the draft. Spawning waits for resolveDraft(): two passive bonuses
  // change a player's starting state, and applying them to a freshly spawned
  // player is simpler than spawning first and patching afterwards.
  start(requesterId: string): { offers: { playerId: string; offer: BonusId[] }[] } | null {
    if (this.status !== 'waiting') return null
    if (this.playerOrder.length === 0) return null
    if (this.playerOrder[0] !== requesterId) return null

    this.draft = new BonusDraft([...this.playerOrder], this.rng)
    this.status = 'drafting'
    return { offers: this.draft.entries() }
  }

  pickBonus(
    playerId: string,
    bonusId: BonusId,
  ): { accepted: boolean; complete: boolean; pickedIds: string[] } {
    if (this.status !== 'drafting' || !this.draft) {
      return { accepted: false, complete: false, pickedIds: [] }
    }
    const accepted = this.draft.pick(playerId, bonusId)
    return {
      accepted,
      complete: this.draft.isComplete(),
      pickedIds: this.draft.pickedIds(),
    }
  }

  isDrafting(): boolean {
    return this.status === 'drafting'
  }

  draftComplete(): boolean {
    return this.draft?.isComplete() ?? false
  }

  // Closes the draft: auto-picks for stragglers, spawns the lineup, applies
  // every drafted bonus, and hands the gateway the usual game-started payload.
  resolveDraft(): GameStartedPayload | null {
    if (this.status !== 'drafting' || !this.draft) return null
    const picks = this.draft.resolve()
    this.draft = null

    this.players.clear()
    this.bots = []
    this.spawnLineup()
    this.status = 'running'

    for (const player of this.players.values()) {
      const bonusId = picks.get(player.id)
      if (bonusId) this.assignBonus(player, bonusId)
    }

    return {
      players: this.snapshotPlayers(),
      bots: this.snapshotBots(),
      arrivalLineX: ARRIVAL_LINE_X,
    }
  }

  // Grants a bonus and runs its spawn-time effect. A bonus with an activation
  // or a save gets exactly one charge; a purely passive one gets none.
  private assignBonus(player: PlayerInternalState, bonusId: BonusId): void {
    const def = BONUS_REGISTRY[bonusId]
    player.bonus = bonusId
    player.bonusCharges = def.onActivate || def.onLethalHit ? 1 : 0
    def.onRoundStart?.(this.bonusContext(player))
  }

  private bonusContext(player: PlayerInternalState): BonusContext {
    return {
      player,
      aliveBots: () => this.bots.filter((b) => b.isAlive),
      rng: this.rng,
    }
  }

  // Test-only: grants a bonus as if it had been drafted, so effect tests do
  // not have to steer the random draw.
  forceBonusForTest(playerId: string, bonusId: BonusId): void {
    const player = this.players.get(playerId)
    if (player) this.assignBonus(player, bonusId)
  }
```

Move the body of the old `start()` (the `Slot` lineup, shuffle and stratified y) into a private `spawnLineup(): void` — it keeps the code and comments unchanged, minus the `this.players.clear()` / `this.bots = []` lines (now in `resolveDraft`) and minus the `return`.

- [ ] **Step 4: Strip the private fields from every snapshot**

Add the helper and use it in both places that publish players:

```ts
  // Drops the server-private fields (bonus, charges, speed) so a snapshot
  // never leaks a player's drafted bonus to the rest of the room.
  private snapshotPlayers(): PlayerState[] {
    return [...this.players.values()].map(
      ({ bonus: _b, bonusCharges: _c, runMultiplier: _m, ...rest }) => rest,
    )
  }
```

`snapshotState()` becomes:

```ts
  snapshotState(): StatePayload {
    return { players: this.snapshotPlayers(), bots: this.snapshotBots() }
  }
```

- [ ] **Step 5: Initialise the new fields at spawn and use the multiplier**

In `spawnPlayer()`, add to the returned object:

```ts
      bonus: null,
      bonusCharges: 0,
      runMultiplier: 1,
```

and change its return type to `PlayerInternalState`.

In `tick()`, the run branch becomes:

```ts
      if (space && shift) {
        player.animation = 'run'
        player.x += RUN_SPEED * GameRoomService.TICK_SCALE * player.runMultiplier
      } else if (space) {
```

- [ ] **Step 6: Clear the draft on leave and on replay**

In `removePlayer()`, right after `this.scores.delete(id)`:

```ts
this.draft?.forget(id)
```

and inside the empty-room branch, next to `this.status = 'waiting'`:

```ts
this.draft = null
```

In `replay()`, next to `this.players.clear()`:

```ts
this.draft = null
```

- [ ] **Step 7: Update the existing tests that assumed `start()` spawns**

Every existing suite that calls `room.start('a')` and then inspects players or fires must now resolve the draft. Add this helper at the top of the spec file and use it in place of `room.start('a')` in the `fire`, `win condition`, `bots` and `scores` suites:

```ts
// Rounds now open on a bonus draft. Tests that care about the field, not the
// draft, go straight through it: nobody picks, so every player gets a random
// card, and the effect tests override it with forceBonusForTest.
function startRound(room: GameRoomService, hostId: string): void {
  room.start(hostId)
  room.resolveDraft()
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter server test && pnpm typecheck`
Expected: PASS — the whole suite, old and new.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/game/game-room.service.ts apps/server/src/game/game-room.service.spec.ts
git commit -m "feat(server): open each round on a bonus draft"
```

---

### Task 5: Activation and lethal-hit effects

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts`
- Modify: `apps/server/src/game/game-room.service.spec.ts`

**Interfaces:**

- Consumes: `BONUS_REGISTRY`, `LethalHitOutcome` (Task 3); `forceBonusForTest` (Task 4).
- Produces: `useBonus(playerId)` → `{ bonusId: BonusId; reveal: boolean } | null`; `fire()`'s return type gains `absorbedBy?: { playerId: string; bonusId: BonusId }`. Task 6 consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/game/game-room.service.spec.ts`:

```ts
describe('GameRoomService — bonus effects in game', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
  })

  const aliveBots = () => room.botsForTest().filter((b) => b.isAlive)

  it('the bomb kills a fifth of the bots and no player', () => {
    room.forceBonusForTest('a', 'bomb')
    const before = aliveBots().length
    expect(room.useBonus('a')).toEqual({ bonusId: 'bomb', reveal: true })
    expect(aliveBots()).toHaveLength(before - Math.ceil(before * 0.2))
    expect(room.snapshotState().players.every((p) => p.isAlive)).toBe(true)
  })

  it('spends the bomb charge, so a second press does nothing', () => {
    room.forceBonusForTest('a', 'bomb')
    room.useBonus('a')
    expect(room.useBonus('a')).toBeNull()
  })

  it('keeps the bomb charge when there is no bot left to kill', () => {
    room.forceBonusForTest('a', 'bomb')
    for (const bot of room.botsForTest()) bot.isAlive = false
    expect(room.useBonus('a')).toBeNull()
  })

  it('refuses to activate a passive bonus', () => {
    room.forceBonusForTest('a', 'vest')
    expect(room.useBonus('a')).toBeNull()
  })

  it('reports the skin swap without revealing it', () => {
    room.forceBonusForTest('a', 'skin-swap')
    expect(room.useBonus('a')).toEqual({ bonusId: 'skin-swap', reveal: false })
  })

  it('the vest absorbs the first hit and is reported to the gateway', () => {
    room.forceBonusForTest('b', 'vest')
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(result.absorbedBy).toEqual({ playerId: 'b', bonusId: 'vest' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(true)
    // An absorbed hit pays nothing: no point, no bullet back.
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(0)
  })

  it('the vest only saves once', () => {
    room.forceBonusForTest('b', 'vest')
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    room.setBulletsForTest('a', 1)
    room.fire('a', { x: b.x, y: b.y - 10 })
    room.setBulletsForTest('a', 1)
    const second = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(second.absorbedBy).toBeUndefined()
    expect(second.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(false)
  })

  it('the extra life reports the decoy bot as the victim', () => {
    room.forceBonusForTest('b', 'extra-life')
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(result.absorbedBy).toBeUndefined()
    expect(result.hit!.targetId).toMatch(/^bot-/)
    // The shooter killed a bot as far as the pipeline is concerned: no points,
    // no bullet refunded.
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(0)
    const survivor = room.snapshotState().players.find((p) => p.id === 'b')!
    expect(survivor.isAlive).toBe(true)
    expect(survivor.x).not.toBe(b.x)
  })

  it('the extra life cannot save a player once every bot is dead', () => {
    room.forceBonusForTest('b', 'extra-life')
    for (const bot of room.botsForTest()) bot.isAlive = false
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(result.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server test -- game-room.service`
Expected: FAIL — `room.useBonus is not a function`.

- [ ] **Step 3: Add `useBonus()`**

```ts
  // Triggers the player's active bonus. Dead players may use it, exactly as
  // they may still fire — the revenge rule stays uniform.
  useBonus(playerId: string): { bonusId: BonusId; reveal: boolean } | null {
    if (this.status !== 'running') return null
    const player = this.players.get(playerId)
    if (!player?.bonus || player.bonusCharges <= 0) return null
    const def = BONUS_REGISTRY[player.bonus]
    if (!def.onActivate) return null
    const outcome = def.onActivate(this.bonusContext(player))
    // A refused activation (nothing to act on) keeps the charge.
    if (!outcome) return null
    player.bonusCharges -= 1
    return { bonusId: player.bonus, reveal: outcome.reveal }
  }
```

- [ ] **Step 4: Run the lethal-hit hook inside `fire()`**

Widen the return type:

```ts
  fire(
    shooterId: string,
    pointer: { x: number; y: number },
    scale = 1,
  ): {
    shooterId: string
    origin: { x: number; y: number }
    hit: { targetId: string } | null
    // Set when a bonus swallowed the hit: the target lives, and the gateway
    // announces the bonus instead of a kill.
    absorbedBy?: { playerId: string; bonusId: BonusId }
  } | null {
```

and replace the block that starts at `if (hit) {` with:

```ts
if (!hit) return { shooterId, origin: pointer, hit: null }

const target = this.players.get(hit.id)
const outcome = target ? this.applyLethalHit(target) : null
if (outcome?.survived) {
  if (outcome.diedInstead) {
    // A bot died in the player's place: report it as the victim so the
    // rest of the pipeline treats this as an ordinary bot kill — no
    // points, no bullet back, no kill banner.
    return { shooterId, origin: pointer, hit: { targetId: outcome.diedInstead.id } }
  }
  return {
    shooterId,
    origin: pointer,
    hit: { targetId: hit.id },
    absorbedBy: { playerId: hit.id, bonusId: target!.bonus! },
  }
}

hit.isAlive = false
hit.animation = 'die'
// Player kills earn the shooter +2 and a replacement bullet. Bot kills
// earn neither (bots are not in the leaderboard). `this.players` is the
// authoritative set of real players; using it as a guard avoids
// depending on the id naming convention `bot-N`. Dead shooters are
// rewarded too — they can already fire, so the rule stays uniform.
if (this.players.has(hit.id)) {
  this.creditPoints(shooterId, 2)
  shooter.bulletsRemaining += BULLET_REWARD_PER_PLAYER_KILL
}
return { shooterId, origin: pointer, hit: { targetId: hit.id } }
```

Add the helper below `fire()`:

```ts
  // Gives a hit player's bonus a chance to save them. Returns null when they
  // have no such bonus or no charge left.
  private applyLethalHit(target: PlayerInternalState): LethalHitOutcome | null {
    if (!target.bonus || target.bonusCharges <= 0) return null
    const def = BONUS_REGISTRY[target.bonus]
    if (!def.onLethalHit) return null
    const outcome = def.onLethalHit(this.bonusContext(target))
    // A hook that failed to save the player (no bot to swap with) costs
    // nothing — the charge is still there for next time.
    if (outcome.survived) target.bonusCharges -= 1
    return outcome
  }
```

and extend the registry import:

```ts
import { BONUS_REGISTRY, type BonusContext, type LethalHitOutcome } from './bonuses'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/game/game-room.service.ts apps/server/src/game/game-room.service.spec.ts
git commit -m "feat(server): wire bonus activation and lethal-hit saves"
```

---

### Task 6: Gateway wiring

**Files:**

- Modify: `apps/server/src/game/game.gateway.ts`

**Interfaces:**

- Consumes: `start()`, `pickBonus()`, `resolveDraft()`, `draftComplete()`, `isDrafting()` (Task 4); `useBonus()`, `fire().absorbedBy` (Task 5); `DRAFT_DURATION_MS`, `BONUS_INFO`, `PickBonusPayload` (Task 1).
- Produces: the `bonus-draft-started`, `bonus-draft-progress` and `bonus-used` emissions the client listens to in Tasks 8 and 9.

- [ ] **Step 1: Add the draft timer map**

Next to `tickHandles`:

```ts
  // Per-room draft deadline. Same lifecycle as tickHandles: armed when the
  // draft opens, cleared when it resolves or the room dies.
  private readonly draftHandles = new Map<string, ReturnType<typeof setTimeout>>()
```

- [ ] **Step 2: Turn `start` into the draft opener**

```ts
  @SubscribeMessage('start')
  onStart(@ConnectedSocket() socket: AppSocket): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const result = ctx.room.start(socket.id)
    if (!result) return
    // Socket.io puts every socket in a room named after its own id, so this
    // delivers each player only its own three cards.
    for (const { playerId, offer } of result.offers) {
      this.server.to(playerId).emit('bonus-draft-started', {
        offer,
        durationMs: DRAFT_DURATION_MS,
      })
    }
    this.broadcastLobby(ctx.code)
    this.armDraftTimer(ctx.code)
  }
```

Import `DRAFT_DURATION_MS` alongside `SERVER_TICK_HZ`.

- [ ] **Step 3: Handle `pick-bonus` and add the draft helpers**

```ts
  @SubscribeMessage('pick-bonus')
  onPickBonus(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: PickBonusPayload,
  ): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const result = ctx.room.pickBonus(socket.id, payload.bonusId)
    if (!result.accepted) return
    this.server.to(ctx.code).emit('bonus-draft-progress', { pickedIds: result.pickedIds })
    if (result.complete) this.resolveDraft(ctx.code)
  }

  private armDraftTimer(code: string): void {
    if (this.draftHandles.has(code)) return
    const handle = setTimeout(() => this.resolveDraft(code), DRAFT_DURATION_MS)
    this.draftHandles.set(code, handle)
  }

  private clearDraftTimer(code: string): void {
    const handle = this.draftHandles.get(code)
    if (!handle) return
    clearTimeout(handle)
    this.draftHandles.delete(code)
  }

  // Both paths out of the draft — everyone picked, or the clock ran out —
  // land here.
  private resolveDraft(code: string): void {
    this.clearDraftTimer(code)
    const room = this.registry.get(code)
    if (!room) return
    const started = room.resolveDraft()
    if (!started) return
    this.server.to(code).emit('game-started', started)
    this.broadcastLobby(code)
    this.startTickLoop(code)
  }
```

Add `PickBonusPayload` to the type-only import from `@hips/shared`.

- [ ] **Step 4: Handle `use-bonus`**

```ts
  @SubscribeMessage('use-bonus')
  onUseBonus(@ConnectedSocket() socket: AppSocket): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const used = ctx.room.useBonus(socket.id)
    if (!used) return
    this.emitBonusUsed(ctx.code, socket.id, used.bonusId, used.reveal)
  }

  // A revealed bonus goes to the whole room, owner included. A silent one
  // goes to its owner alone — their HUD still has to learn the charge is
  // spent. Socket.io puts every socket in a room named after its own id, so
  // both cases are just a `to()`.
  private emitBonusUsed(
    code: string,
    playerId: string,
    bonusId: BonusId,
    reveal: boolean,
  ): void {
    const room = this.registry.get(code)
    if (!room) return
    const payload = { playerId, username: room.usernameFor(playerId), bonusId }
    this.server.to(reveal ? code : playerId).emit('bonus-used', payload)
  }
```

Add `BonusId` to the type-only import.

- [ ] **Step 5: Announce an absorbed hit instead of a kill**

In `onFire`, replace the `if (result.hit) { … }` block with:

```ts
if (result.absorbedBy) {
  // The target's bonus swallowed the shot. No kill event: the vest is
  // announced instead, which is also what tells its owner it is spent.
  this.emitBonusUsed(ctx.code, result.absorbedBy.playerId, result.absorbedBy.bonusId, true)
  return
}
if (result.hit) {
  // Bots have no entry in the usernames map → usernameFor returns ''.
  // Only attach `username` when it's a real player so the client can
  // distinguish "show death banner" from "silent bot kill". The shooter
  // is always a real player (sockets only), so killerUsername is attached
  // alongside the victim's username for the kill-feed banner.
  const username = ctx.room.usernameFor(result.hit.targetId)
  const killerUsername = ctx.room.usernameFor(socket.id)
  this.server.to(ctx.code).emit('player-killed', {
    id: result.hit.targetId,
    ...(username ? { username, killerUsername, killerId: socket.id } : {}),
  })
}
```

- [ ] **Step 6: Clean up the draft on disconnect**

In `handleDisconnect`, after `this.broadcastLobby(code)`:

```ts
// A player leaving mid-draft may be the one everyone was waiting for.
if (room.isDrafting() && room.draftComplete()) this.resolveDraft(code)
```

and inside the `room.isEmpty()` branch, next to `this.stopTickLoop(code)`:

```ts
this.clearDraftTimer(code)
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter server test && pnpm typecheck && pnpm --filter server lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/game/game.gateway.ts
git commit -m "feat(server): broadcast the draft and bonus usage"
```

---

### Task 7: The draft overlay

**Files:**

- Create: `apps/client/src/ui/BonusDraftOverlay.ts`

**Interfaces:**

- Consumes: `BonusId`, `BONUS_INFO` (Task 1); `Button` from `./Button`.
- Produces: `BonusDraftOverlay` with constructor options `{ width, height, offer, durationMs, players, onPick }`, and the methods `setPlayers`, `setPicked`, `resize`, `tick`. Task 8 drives all of them.

- [ ] **Step 1: Write the overlay**

```ts
import type { BonusId } from '@hips/shared'
import { BONUS_INFO } from '@hips/shared'
import { Container, Graphics, Text } from 'pixi.js'

export interface BonusDraftPlayer {
  id: string
  username: string
  isMe: boolean
}

export interface BonusDraftOverlayOptions {
  width: number
  height: number
  offer: BonusId[]
  durationMs: number
  players: BonusDraftPlayer[]
  onPick: (bonusId: BonusId) => void
}

const CARD_WIDTH = 210
const CARD_HEIGHT = 250
const CARD_GAP = 24

// Full-screen bonus draft: three cards, a countdown, and the roster with a
// checkmark as each player locks their pick. Mirrors WaitingRoomOverlay's
// shape (rebuild-on-change, resize, French copy) so the two feel like one UI.
export class BonusDraftOverlay extends Container {
  private width_: number
  private height_: number
  private readonly offer: BonusId[]
  private readonly onPick: (bonusId: BonusId) => void
  private players: BonusDraftPlayer[]
  private picked = new Set<string>()
  private myPick: BonusId | null = null
  private readonly deadline: number
  // Seconds currently painted on the countdown, so tick() only rebuilds on a
  // second boundary instead of 60 times a second.
  private renderedSeconds = -1

  constructor(opts: BonusDraftOverlayOptions) {
    super()
    this.width_ = opts.width
    this.height_ = opts.height
    this.offer = opts.offer
    this.players = opts.players
    this.onPick = opts.onPick
    this.deadline = Date.now() + opts.durationMs
    this.rebuild()
  }

  setPlayers(players: BonusDraftPlayer[]): void {
    this.players = players
    this.rebuild()
  }

  setPicked(ids: string[]): void {
    this.picked = new Set(ids)
    this.rebuild()
  }

  resize(width: number, height: number): void {
    this.width_ = width
    this.height_ = height
    this.rebuild()
  }

  // Called from the scene's update loop.
  tick(): void {
    if (this.secondsLeft() === this.renderedSeconds) return
    this.rebuild()
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000))
  }

  private rebuild(): void {
    this.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.renderedSeconds = this.secondsLeft()

    const w = this.width_
    const h = this.height_

    this.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.85 }))

    const title = new Text({
      text: this.myPick ? 'En attente des autres joueurs…' : 'Choisis ton bonus',
      style: { fill: 0xfff700, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(w / 2, h / 2 - 190)
    this.addChild(title)

    const countdown = new Text({
      text: `${this.renderedSeconds} s`,
      style: { fill: 0xffffff, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    countdown.anchor.set(0.5)
    countdown.position.set(w / 2, h / 2 - 150)
    this.addChild(countdown)

    const span = this.offer.length * CARD_WIDTH + (this.offer.length - 1) * CARD_GAP
    const firstX = w / 2 - span / 2 + CARD_WIDTH / 2
    this.offer.forEach((bonusId, i) => {
      const card = this.buildCard(bonusId)
      card.position.set(firstX + i * (CARD_WIDTH + CARD_GAP), h / 2)
      this.addChild(card)
    })

    const rosterY = h / 2 + CARD_HEIGHT / 2 + 40
    this.players.forEach((p, i) => {
      const mark = this.picked.has(p.id) ? '✓' : '…'
      const text = new Text({
        text: `${p.username} ${mark}`,
        style: {
          fill: p.isMe ? 0xfff700 : 0xcccccc,
          fontSize: 16,
          fontFamily: 'Space Mono, monospace',
        },
      })
      text.anchor.set(0.5)
      text.position.set(w / 2, rosterY + i * 22)
      this.addChild(text)
    })
  }

  private buildCard(bonusId: BonusId): Container {
    const info = BONUS_INFO[bonusId]
    const card = new Container()
    // Once you have picked, the cards freeze: the chosen one stays lit, the
    // other two dim, and nothing is clickable any more.
    const chosen = this.myPick === bonusId
    const locked = this.myPick !== null
    const border = chosen || !locked ? 0xfff700 : 0x555555

    card.addChild(
      new Graphics()
        .roundRect(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 10)
        .fill({ color: 0x1f2937 })
        .stroke({ width: chosen ? 4 : 2, color: border }),
    )

    const icon = new Text({ text: info.icon, style: { fontSize: 52 } })
    icon.anchor.set(0.5)
    icon.position.set(0, -CARD_HEIGHT / 2 + 56)
    card.addChild(icon)

    const name = new Text({
      text: info.name,
      style: {
        fill: 0xfff700,
        fontSize: 20,
        fontFamily: 'Space Mono, monospace',
        fontWeight: 'bold',
      },
    })
    name.anchor.set(0.5)
    name.position.set(0, -CARD_HEIGHT / 2 + 110)
    card.addChild(name)

    const description = new Text({
      text: info.description,
      style: {
        fill: 0xcccccc,
        fontSize: 13,
        fontFamily: 'Space Mono, monospace',
        wordWrap: true,
        wordWrapWidth: CARD_WIDTH - 28,
        align: 'center',
      },
    })
    description.anchor.set(0.5, 0)
    description.position.set(0, -CARD_HEIGHT / 2 + 136)
    card.addChild(description)

    if (!locked) {
      card.eventMode = 'static'
      card.cursor = 'pointer'
      card.on('pointertap', () => {
        this.myPick = bonusId
        this.rebuild()
        this.onPick(bonusId)
      })
    } else {
      card.alpha = chosen ? 1 : 0.45
    }
    return card
  }
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `pnpm --filter @hips/shared build && pnpm --filter client typecheck && pnpm --filter client lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ui/BonusDraftOverlay.ts
git commit -m "feat(client): add the bonus draft overlay"
```

---

### Task 8: Draft flow in GameScene

**Files:**

- Modify: `apps/client/src/scenes/GameScene.ts`

**Interfaces:**

- Consumes: `BonusDraftOverlay` (Task 7); `bonus-draft-started`, `bonus-draft-progress` (Task 6).
- Produces: the `myBonus` / `bonusSpent` fields Task 9 reads, and `lobbyPlayers`.

- [ ] **Step 1: Add the fields**

```ts
  private draftOverlay: BonusDraftOverlay | null = null
  private bonusDraftStartedHandler:
    | ((payload: BonusDraftStartedPayload) => void)
    | null = null
  private bonusDraftProgressHandler:
    | ((payload: BonusDraftProgressPayload) => void)
    | null = null
  // Last lobby roster, kept so the draft overlay can show who has picked.
  private lobbyPlayers: { id: string; username: string }[] = []
  // The bonus this client drafted this round, and whether its charge is gone.
  // Never comes from a snapshot: the pick is secret, so the client is the one
  // that remembers its own.
  private myBonus: BonusId | null = null
  private bonusSpent = false
```

Import `BONUS_INFO`, and the types `BonusDraftStartedPayload`, `BonusDraftProgressPayload`, `BonusId`, `BonusUsedPayload` from `@hips/shared`, plus `BonusDraftOverlay` from `../ui/BonusDraftOverlay`.

- [ ] **Step 2: Subscribe and unsubscribe**

In `onEnter`, next to the other handlers:

```ts
this.bonusDraftStartedHandler = (payload) => this.startDraft(payload)
this.bonusDraftProgressHandler = (payload) => this.draftOverlay?.setPicked(payload.pickedIds)
```

```ts
this.game.net.on('bonus-draft-started', this.bonusDraftStartedHandler)
this.game.net.on('bonus-draft-progress', this.bonusDraftProgressHandler)
```

In `onExit`, mirror the existing `if (handler) { off(); handler = null }` blocks for both, and destroy the overlay:

```ts
this.draftOverlay?.destroy({ children: true })
this.draftOverlay = null
```

- [ ] **Step 3: Remember the roster in `applyLobby`**

At the top of `applyLobby`, before the early return on `waitingOverlay`:

```ts
this.lobbyPlayers = payload.players.map((p) => ({
  id: p.id,
  username: p.username,
}))
this.draftOverlay?.setPlayers(this.draftPlayers())
```

- [ ] **Step 4: Open the draft**

```ts
  private startDraft(payload: BonusDraftStartedPayload): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.myBonus = null
    this.bonusSpent = false

    const { canvasWidth, canvasHeight } = this.game.layout
    this.draftOverlay = new BonusDraftOverlay({
      width: canvasWidth,
      height: canvasHeight,
      offer: payload.offer,
      durationMs: payload.durationMs,
      players: this.draftPlayers(),
      onPick: (bonusId) => {
        this.myBonus = bonusId
        this.game.net.emit('pick-bonus', { bonusId })
      },
    })
    this.addChild(this.draftOverlay)
  }

  private draftPlayers(): { id: string; username: string; isMe: boolean }[] {
    const me = this.game.net.id
    return this.lobbyPlayers.map((p) => ({ ...p, isMe: p.id === me }))
  }
```

- [ ] **Step 5: Close the draft and keep the countdown ticking**

At the top of `startGame`, next to the waiting-overlay teardown:

```ts
this.draftOverlay?.destroy({ children: true })
this.draftOverlay = null
```

And next to the existing `this.game.input.consumeFire()` at the end of
`startGame`, drain the bonus flag for the same reason — a `B` pressed while
the draft overlay was up must not fire the bonus on the first frame:

```ts
this.game.input.consumeBonus()
```

In `update`, right after `this.updateBulletRewardFlash()`:

```ts
this.draftOverlay?.tick()
```

In `resize`, next to `this.waitingOverlay?.resize(canvasWidth, canvasHeight)`:

```ts
this.draftOverlay?.resize(canvasWidth, canvasHeight)
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter client typecheck && pnpm --filter client lint`
Expected: PASS.

- [ ] **Step 7: Manual check**

Run `pnpm dev`, open two browser windows on `http://localhost:5173`, create a room in one and join with the code in the other, then press Démarrer.
Expected: both windows show three cards and a countdown; clicking a card freezes it and shows "En attente des autres joueurs…"; the roster gets a ✓ for whoever picked; when both have picked the game starts immediately; leaving one window untouched starts the game after 15 s.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/scenes/GameScene.ts
git commit -m "feat(client): run the bonus draft before a round starts"
```

---

### Task 9: Trigger, HUD and reveal banner

**Files:**

- Modify: `apps/client/src/systems/InputManager.ts`
- Modify: `apps/client/src/ui/MobileControls.ts`
- Modify: `apps/client/src/scenes/GameScene.ts`

**Interfaces:**

- Consumes: `myBonus` / `bonusSpent` (Task 8); `bonus-used` (Task 6); `BONUS_INFO` (Task 1).
- Produces: `InputManager.consumeBonus()` / `triggerBonus()`; `MobileControls` options gain `onBonus`, and the class gains `setBonusAvailable(available: boolean)`.

- [ ] **Step 1: Add the bonus key to `InputManager`**

Field, next to `firedThisFrame`:

```ts
  // Edge-triggered like firedThisFrame: B (or the mobile bonus button) sets
  // it, the scene's update loop consumes it exactly once.
  private bonusThisFrame = false
```

Methods, next to `consumeFire` / `triggerFire`:

```ts
  consumeBonus(): boolean {
    const used = this.bonusThisFrame
    this.bonusThisFrame = false
    return used
  }

  triggerBonus(): void {
    this.bonusThisFrame = true
  }
```

And in `onKeyDown`, after `this.keys.add(event.key)`:

```ts
if (event.key === 'b' || event.key === 'B') this.bonusThisFrame = true
```

- [ ] **Step 2: Add the bonus button to `MobileControls`**

Extend the options:

```ts
  onBonus: () => void
```

Add the field and build it in the constructor, after `runBtn`:

```ts
this.bonusBtn = new HoldButton({
  icon: drawBonusIcon,
  fillColor: 0x1f2937,
  activeFillColor: 0x3b5468,
  onDown: opts.onBonus,
  // Tap, not hold: everything happens on the press.
  onUp: () => {},
})
// Hidden until the player drafts an active bonus.
this.bonusBtn.visible = false
```

Declare `private readonly bonusBtn: HoldButton`, add it to the `addChild(...)` call, and add:

```ts
  setBonusAvailable(available: boolean): void {
    this.bonusBtn.visible = available
  }
```

In `layout()`, place it above the walk button in the same column:

```ts
this.bonusBtn.position.set(cx, columnCenterY - halfSpan - BUTTON_SIZE - BUTTON_GAP / 2)
```

And the icon, next to `drawWalkIcon` / `drawRunIcon`:

```ts
// A star, drawn on the same 24×24 viewBox as the other pictograms so
// HoldButton's centering and scaling apply unchanged.
function drawBonusIcon(g: Graphics): void {
  g.clear().star(12, 12, 5, 11, 5).fill({ color: ICON_COLOR })
}
```

- [ ] **Step 3: Pass the callback in `GameScene.setupMobileUI`**

Add to the `new MobileControls({ … })` options:

```ts
      onBonus: () => this.game.input.triggerBonus(),
```

- [ ] **Step 4: Emit the activation and show the reveal banner**

In `update`, next to the fire emit (inside the `gameStarted` section):

```ts
if (this.game.input.consumeBonus() && this.canUseBonus()) {
  this.game.net.emit('use-bonus')
}
```

Add the handler and its helpers:

```ts
  // Only active, unspent bonuses have anything to trigger. The server checks
  // all of this again — this only avoids a pointless round trip.
  private canUseBonus(): boolean {
    if (!this.myBonus || this.bonusSpent) return false
    return BONUS_INFO[this.myBonus].kind === 'active'
  }

  private onBonusUsed(payload: BonusUsedPayload): void {
    if (payload.playerId === this.game.net.id) {
      this.bonusSpent = true
      this.mobileControls?.setBonusAvailable(false)
      this.refreshBonusHud()
      return
    }
    // Reaching here means the server chose to reveal it: only revealed
    // bonuses are broadcast beyond their owner.
    const info = BONUS_INFO[payload.bonusId]
    if (!info.usedMessage) return
    this.addDeathBanner(`${info.icon} ${payload.username} ${info.usedMessage}`)
  }
```

Wire it in `onEnter` / `onExit` exactly like `playerKilledHandler`, with a `bonusUsedHandler` field.

- [ ] **Step 5: Show the bonus in the HUD**

Keep the last bullet line so the bonus suffix can be re-rendered on its own:

```ts
  private hudBullets = ''
```

`refreshHud` becomes:

```ts
  private refreshHud(state: PlayerState): void {
    this.isAlive = state.isAlive
    const alive = state.isAlive ? '' : ' (mort)'
    this.hudBullets = `Balles : ${state.bulletsRemaining}${alive}`
    this.refreshBonusHud()
  }

  private refreshBonusHud(): void {
    if (!this.hud) return
    if (!this.myBonus) {
      this.hud.text = this.hudBullets
      return
    }
    const info = BONUS_INFO[this.myBonus]
    const state = this.bonusSpent ? ' (utilisé)' : info.kind === 'active' ? ' [B]' : ''
    this.hud.text = `${this.hudBullets}  ·  ${info.icon} ${info.name}${state}`
  }
```

And in `startGame`, once the HUD exists:

```ts
this.mobileControls?.setBonusAvailable(this.canUseBonus())
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter client typecheck && pnpm --filter client lint`
Expected: PASS.

- [ ] **Step 7: Manual check**

Run `pnpm dev` with two windows. Play rounds until one window drafts the Bombe (restart with Rejouer as needed), then press `B`.
Expected: several bots collapse at once, the HUD flips to `💣 Bombe (utilisé)`, a second press does nothing, and the other window shows the banner `💣 <pseudo> a lâché une bombe`.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/systems/InputManager.ts apps/client/src/ui/MobileControls.ts apps/client/src/scenes/GameScene.ts
git commit -m "feat(client): trigger active bonuses and surface them in the HUD"
```

---

### Task 10: Body-swap rendering

**Files:**

- Modify: `apps/client/src/scenes/GameScene.ts`

**Interfaces:**

- Consumes: `reconcileZombie` (existing), the swap effects from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Rebuild a zombie whose appearance changed**

`PlayerZombie` takes its textures at construction and ignores a later change of `type`, but both body-swap bonuses change it. In `reconcileZombie`:

```ts
  private reconcileZombie(state: ZombieState): void {
    let existing = this.remoteZombies.get(state.id)
    // Both body-swap bonuses change a zombie's appearance mid-round, and the
    // sprite sheets are bound at construction — so a type change means a
    // rebuild, not an update.
    if (existing && existing.type !== state.type) {
      existing.destroy({ children: true })
      this.remoteZombies.delete(state.id)
      existing = undefined
    }
    if (existing) {
      existing.applyServerState(state)
    } else {
      const z = this.makeZombie(state)
      this.remoteZombies.set(state.id, z)
      this.gameLayer.addChild(z)
    }
  }
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter server test`
Expected: PASS.

- [ ] **Step 3: Manual check of both swaps**

Run `pnpm dev` with two windows.

- Draft **Changement de peau** in one window and press `B`: that player jumps to another spot on the field and its sprite changes; the bot it swapped with is now where the player stood; both stay alive; the other window shows no banner.
- Draft **Seconde vie** in one window, then shoot that player from the other: the shooter sees a zombie die where they aimed and gets no kill banner and no bullet back; the victim's window shows them alive somewhere else with a different appearance.
- Draft **Gilet** and shoot its owner: they stay standing, the shooter sees blood, both windows show `🛡️ <pseudo> a encaissé le tir`, and a second shot kills them.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/scenes/GameScene.ts
git commit -m "fix(client): rebuild a zombie when a body swap changes its sprite"
```

---

## Notes for the executor

- `pnpm --filter server test -- <pattern>` runs a single Jest file; `pnpm --filter server test` runs the suite.
- `packages/shared` must be rebuilt (`pnpm --filter @hips/shared build`) before the client typechecks against new shared exports — the dev script does it automatically.
- The pre-commit hook runs eslint and a workspace-wide typecheck. If it rejects a commit, fix the code rather than bypassing the hook.
- Commits in this plan are one logical change each. If a later task needs to correct an earlier unpushed commit from this same branch, use `git commit --fixup=<sha>` and squash with `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <base>` before pushing.
