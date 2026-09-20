# End-of-Round Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-room cumulative score system that surfaces a ranked
leaderboard at the end of every game, displayed alongside the existing
end-game UI in a two-column EndScene layout.

**Architecture:** Server-authoritative. `GameRoomService` keeps a
`Map<playerId, { total, lastDelta }>` that survives `replay()` but is wiped
when the room empties. Points are credited inline in `fire()` (player kills)
and `tickAndCheckWinner()` (arrival). The gateway snapshots the leaderboard
into `game-ended`. The client forwards it to `EndScene`, which splits its
layout: existing title/subtitle/button on the left, leaderboard table on the
right.

**Tech Stack:** TypeScript, NestJS (server), Pixi.js (client), Jest, pnpm
workspace.

**Spec:** [`docs/superpowers/specs/2026-05-21-leaderboard-design.md`](../specs/2026-05-21-leaderboard-design.md)

---

## Preflight

Before starting Task 0, the working tree contains uncommitted code from
recent sessions (random zombie types, BANG kill banner, all-dead game end).
These must be committed first so the leaderboard commits don't bundle in
unrelated work. Recommended split:

1. `feat(server): randomise zombie type per spawn` — game-room.service.ts +
   spec changes for random types.
2. `feat(server): track killer username on player-killed; client BANG banner`
   — shared/index.ts (killerUsername), gateway, GameScene banner code.
3. `feat: end the game when all real players are dead` — shared (`reason`),
   game-room.service (tickAndCheckWinner all-dead branch), spec, gateway,
   GameScene.onGameEnded, EndScene reason discriminator.

The plan author has already verified that splitting this way produces three
focused, individually-testable commits — but the engineer running this plan
should review `git status` / `git diff` for themselves before committing.

Run the full test battery once the three preliminary commits are in place:

```bash
pnpm --filter @hips/shared build
pnpm --filter server test
pnpm --filter client typecheck
```

All three must exit 0 with 56 server tests passing before starting Task 0.

---

### Task 0: Commit the design spec

The brainstorming session produced the spec doc but didn't commit it. Land
it before any code change so the plan and spec travel together.

**Files:**

- Modify: `docs/superpowers/specs/2026-05-21-leaderboard-design.md` (already created, untracked)
- Modify: `docs/superpowers/plans/2026-05-21-leaderboard.md` (this file, untracked)

- [ ] **Step 1: Stage and commit the spec + plan**

```bash
git add docs/superpowers/specs/2026-05-21-leaderboard-design.md docs/superpowers/plans/2026-05-21-leaderboard.md
git commit -m "$(cat <<'EOF'
docs(leaderboard): spec + implementation plan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: Shared types — `LeaderboardEntry` + extend `GameEndedPayload`

Add the wire type and the new field on `GameEndedPayload`. No tests (the
shared package only ships type-level + constants and currently has no test
suite); type safety is verified by `pnpm --filter client typecheck` and the
server jest run at later tasks.

**Files:**

- Modify: `packages/shared/src/index.ts:130-141`

- [ ] **Step 1: Add `LeaderboardEntry` and field on `GameEndedPayload`**

Replace the existing `GameEndedPayload` block (lines 130-141, the
`reason`/`winnerId`/`winnerUsername` discriminated payload) with:

```ts
// Per-player score row sent at the end of every round. Already sorted by
// the server: total desc, then lastDelta desc, then username asc.
export interface LeaderboardEntry {
  id: string
  username: string
  total: number
  lastDelta: number
}

// Game end has two outcomes:
//   - 'arrival': a player crossed the arrival line. `winnerId`/`winnerUsername`
//     identify them.
//   - 'all-dead': every connected player died. No winner; the client shows
//     "Vous êtes tous morts !" instead of the usual win/lose split.
export type GameEndReason = 'arrival' | 'all-dead'
export interface GameEndedPayload {
  reason: GameEndReason
  winnerId?: string
  winnerUsername?: string
  leaderboard: LeaderboardEntry[]
}
```

- [ ] **Step 2: Rebuild the shared package**

The server consumes `packages/shared/dist/` (CJS), so a rebuild is mandatory
after any type change. The client reads `src/` directly via Vite — no
rebuild needed for client typecheck, but the build is harmless.

Run: `pnpm --filter @hips/shared build`
Expected: exits 0 with no output beyond `> tsc`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/dist/
git commit -m "$(cat <<'EOF'
feat(shared): add LeaderboardEntry, extend GameEndedPayload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Score map + kill-scoring (TDD)

Introduce the internal score state and credit +2 on every player-on-player
kill. Verify bot kills give 0.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts:67-89` (class field block) and `:290-324` (`fire()` body)
- Test: `apps/server/src/game/game-room.service.spec.ts` (new tests in the existing combat `describe`)

- [ ] **Step 1: Write failing tests**

Open `apps/server/src/game/game-room.service.spec.ts`. Find the
`describe('GameRoomService — fire + bots', ...)` block (around the test
"a bot crossing the arrival line never triggers a winner", line ~473).
Append, **inside the same describe**, two new tests:

```ts
it('credits +2 to the shooter when they kill another player', () => {
  const room = new GameRoomService()
  room.addPlayer('a', 'Antoine')
  room.addPlayer('b', 'Bruno')
  room.start('a')
  // Find Bruno's position and fire on it.
  const victim = room.snapshotState().players.find((p) => p.id === 'b')!
  const result = room.fire('a', { x: victim.x, y: victim.y - 10 })
  expect(result!.hit).toEqual({ targetId: 'b' })
  const board = room.snapshotLeaderboard()
  const shooter = board.find((e) => e.id === 'a')!
  expect(shooter.total).toBe(2)
  expect(shooter.lastDelta).toBe(2)
  const dead = board.find((e) => e.id === 'b')!
  expect(dead.total).toBe(0)
})

it('credits 0 points when the shooter kills a bot', () => {
  const room = new GameRoomService()
  room.addPlayer('a', 'Antoine')
  room.start('a')
  const target = room.botsForTest()[0]!
  room.fire('a', { x: target.x, y: target.y - 10 })
  const shooter = room.snapshotLeaderboard().find((e) => e.id === 'a')!
  expect(shooter.total).toBe(0)
  expect(shooter.lastDelta).toBe(0)
})
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter server test -- -t "credits"`
Expected: both tests fail with `TypeError: room.snapshotLeaderboard is not a function`.

- [ ] **Step 3: Add the score map + credit helper + snapshot method**

In `apps/server/src/game/game-room.service.ts`, near the other private
fields (after `private bots: BotInternalState[] = []` around line 74), add:

```ts
  // Per-room cumulative scores. Survives replay() so a series of games in
  // the same room feels like a tournament; cleared when the room empties.
  private readonly scores = new Map<string, { total: number; lastDelta: number }>()
```

Add a `LeaderboardEntry` import at the top of the file. Find the existing
`@hips/shared` type import block:

```ts
import type {
  BotState,
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerState,
  RoomStatus,
  StatePayload,
  ZombieType,
} from '@hips/shared'
```

Insert `LeaderboardEntry,` alphabetically:

```ts
import type {
  BotState,
  GameStartedPayload,
  InputPayload,
  LeaderboardEntry,
  LobbyStatePayload,
  PlayerState,
  RoomStatus,
  StatePayload,
  ZombieType,
} from '@hips/shared'
```

Add two new private helpers near the bottom of the class (after `spawnPlayer`
is fine):

```ts
  private creditPoints(id: string, points: number): void {
    const entry = this.scores.get(id) ?? { total: 0, lastDelta: 0 }
    entry.total += points
    entry.lastDelta += points
    this.scores.set(id, entry)
  }

  // Public snapshot used by the gateway when emitting `game-ended`. Iterates
  // over playerOrder (every currently-connected player) so a player who has
  // not yet scored still appears in the ranking with 0 pts.
  snapshotLeaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = this.playerOrder.map((id) => {
      const score = this.scores.get(id) ?? { total: 0, lastDelta: 0 }
      return {
        id,
        username: this.usernames.get(id) ?? '',
        total: score.total,
        lastDelta: score.lastDelta,
      }
    })
    entries.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      if (b.lastDelta !== a.lastDelta) return b.lastDelta - a.lastDelta
      return a.username.localeCompare(b.username)
    })
    return entries
  }
```

- [ ] **Step 4: Credit +2 inside `fire()` on player kills**

In `fire()`, locate the existing `if (hit) { hit.isAlive = false; ... }`
block (around line 315). Replace it with:

```ts
if (hit) {
  hit.isAlive = false
  hit.animation = 'die'
  // Player kills earn the shooter +2. Bot kills earn 0 (bots are not in
  // the leaderboard). `this.players` is the authoritative set of real
  // players; using it as a guard avoids depending on the id naming
  // convention `bot-N`.
  if (this.players.has(hit.id)) {
    this.creditPoints(shooterId, 2)
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test -- -t "credits"`
Expected: both tests pass.

- [ ] **Step 6: Run the full server suite to catch regressions**

Run: `pnpm --filter server test`
Expected: all tests pass (was 56, now 58).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game/game-room.service.ts apps/server/src/game/game-room.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): award +2 to the shooter on player kills

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Arrival scoring (TDD)

Credit +7 to the player who crosses the arrival line.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts` (`tickAndCheckWinner` body, currently lines ~235-260)
- Test: `apps/server/src/game/game-room.service.spec.ts` (new test in the existing arrival describe)

- [ ] **Step 1: Write the failing test**

In `game-room.service.spec.ts`, find `describe('GameRoomService — arrival check', ...)`. Just below the existing
"declares the player who crosses the arrival line as winner" test, add:

```ts
it('credits +7 to the player who crosses the arrival line', () => {
  room.teleportForTest('a', ARRIVAL_LINE_X + 1)
  room.tickAndCheckWinner()
  const winner = room.snapshotLeaderboard().find((e) => e.id === 'a')!
  expect(winner.total).toBe(7)
  expect(winner.lastDelta).toBe(7)
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter server test -- -t "credits \\+7"`
Expected: fail — `winner.total` is `0`, expected `7`.

- [ ] **Step 3: Credit +7 inside `tickAndCheckWinner`**

In `game-room.service.ts`, find the arrival-check branch in `tickAndCheckWinner`:

```ts
for (const p of this.players.values()) {
  if (p.isAlive && p.x >= ARRIVAL_LINE_X) {
    this.status = 'ended'
    return { reason: 'arrival', winnerId: p.id }
  }
}
```

Replace with:

```ts
for (const p of this.players.values()) {
  if (p.isAlive && p.x >= ARRIVAL_LINE_X) {
    this.status = 'ended'
    this.creditPoints(p.id, 7)
    return { reason: 'arrival', winnerId: p.id }
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter server test -- -t "credits \\+7"`
Expected: pass.

- [ ] **Step 5: Run the full server suite**

Run: `pnpm --filter server test`
Expected: all tests pass (now 59).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/game/game-room.service.ts apps/server/src/game/game-room.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): award +7 to the player who crosses the arrival line

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Score lifecycle — replay zeroes delta, disconnect drops entry (TDD)

`replay()` keeps totals but zeroes every `lastDelta`. `removePlayer()` removes
the score entry alongside the rest of the player's state.

**Files:**

- Modify: `apps/server/src/game/game-room.service.ts` (`replay`, `removePlayer`)
- Test: `apps/server/src/game/game-room.service.spec.ts` (new tests)

- [ ] **Step 1: Write the failing tests**

In `game-room.service.spec.ts`, find `describe('GameRoomService — replay', ...)`.
Inside it, after the existing tests, append:

```ts
it('keeps cumulative totals but zeroes every lastDelta on replay', () => {
  // beforeEach already set up: 2 players, started, teleported 'a' past the
  // line, ran tickAndCheckWinner (so 'a' has total=7, lastDelta=7).
  expect(room.snapshotLeaderboard().find((e) => e.id === 'a')!.total).toBe(7)
  room.replay('a')
  const after = room.snapshotLeaderboard()
  expect(after.find((e) => e.id === 'a')!.total).toBe(7)
  expect(after.find((e) => e.id === 'a')!.lastDelta).toBe(0)
  expect(after.find((e) => e.id === 'b')!.total).toBe(0)
  expect(after.find((e) => e.id === 'b')!.lastDelta).toBe(0)
})
```

In the same file, find `describe('GameRoomService — disconnect during running', ...)`. Append:

```ts
it('drops the disconnected player from the leaderboard', () => {
  const room = new GameRoomService()
  room.addPlayer('a', 'Antoine')
  room.addPlayer('b', 'Bruno')
  room.start('a')
  // Give 'b' some points so we can prove the entry was really there.
  const victim = room.snapshotState().players.find((p) => p.id === 'a')!
  room.fire('b', { x: victim.x, y: victim.y - 10 })
  expect(room.snapshotLeaderboard().find((e) => e.id === 'b')!.total).toBe(2)
  room.removePlayer('b')
  expect(room.snapshotLeaderboard().find((e) => e.id === 'b')).toBeUndefined()
})
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter server test -- -t "lastDelta|leaderboard"`
Expected: the two new tests fail (the replay test fails on `lastDelta` still
being 7; the disconnect test fails because the entry is still there).

- [ ] **Step 3: Zero deltas on replay**

In `game-room.service.ts`, find `replay()` (around line 326). Replace its body:

```ts
  replay(requesterId: string): boolean {
    if (this.status !== 'ended') return false
    if (this.playerOrder[0] !== requesterId) return false
    this.status = 'waiting'
    this.players.clear()
    this.inputs.clear()
    this.bots = []
    // Keep cumulative totals across the series, but zero out every player's
    // lastDelta so the (+X) indicator shown next round reflects strictly the
    // round that just begins.
    for (const score of this.scores.values()) {
      score.lastDelta = 0
    }
    return true
  }
```

- [ ] **Step 4: Drop entry on `removePlayer`**

In `game-room.service.ts`, find `removePlayer()` (around line 96). Add a
`this.scores.delete(id)` next to the other deletions:

```ts
  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
    this.players.delete(id)
    this.inputs.delete(id)
    this.usernames.delete(id)
    this.scores.delete(id)
    // Empty room: drop any leftover game state so the next connection starts
    // in a clean `waiting` lobby. Without this, refreshing the host while
    // running/ended leaves the room stuck and the next Démarrer click is
    // silently rejected by `start()` (status guard).
    if (this.playerOrder.length === 0 && this.status !== 'waiting') {
      this.status = 'waiting'
    }
  }
```

- [ ] **Step 5: Run the new tests**

Run: `pnpm --filter server test -- -t "lastDelta|leaderboard"`
Expected: both pass.

- [ ] **Step 6: Run the full server suite**

Run: `pnpm --filter server test`
Expected: all tests pass (now 61).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/game/game-room.service.ts apps/server/src/game/game-room.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): persist scores across replay, drop on disconnect

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `snapshotLeaderboard` sort + zero-pt visibility (TDD)

The snapshot has been used informally by Tasks 2-4; now pin its contract
with a deliberate-ties test. Also assert that players who have never scored
appear with a zeroed entry.

**Files:**

- Test: `apps/server/src/game/game-room.service.spec.ts` (new `describe`)

- [ ] **Step 1: Write the pinning tests**

Append a new `describe` block at the bottom of `game-room.service.spec.ts`:

```ts
describe('GameRoomService — leaderboard snapshot', () => {
  it('includes every connected player, even those at 0 points', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    room.start('a')
    const entries = room.snapshotLeaderboard()
    const ids = entries.map((e) => e.id).sort()
    expect(ids).toEqual(['a', 'b'])
    expect(entries.every((e) => e.total === 0 && e.lastDelta === 0)).toBe(true)
  })

  it('sorts by total desc, then lastDelta desc, then username asc', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Aaron')
    room.addPlayer('b', 'Bruno')
    room.addPlayer('c', 'Cécile')
    room.addPlayer('d', 'Zoe')
    room.start('a')
    room.setBulletsForTest('a', 10)
    room.setBulletsForTest('b', 10)
    // 'b' kills 'a' → b: total 2
    const aPos = room.snapshotState().players.find((p) => p.id === 'a')!
    room.fire('b', { x: aPos.x, y: aPos.y - 10 })
    // 'b' kills 'c' → b: total 4
    const cPos = room.snapshotState().players.find((p) => p.id === 'c')!
    room.fire('b', { x: cPos.x, y: cPos.y - 10 })
    // dead 'a' kills 'd' → a: total 2
    const dPos = room.snapshotState().players.find((p) => p.id === 'd')!
    room.fire('a', { x: dPos.x, y: dPos.y - 10 })
    // 'c' (dead, no bullets) stays at 0. 'd' (dead, no bullets) stays at 0.
    // Expected ordering:
    //   1. b (total 4)
    //   2. a (total 2)
    //   3. c (Cécile, 0/0)  — tie with d on total+delta → username asc
    //   4. d (Zoe)          — 'Cécile' < 'Zoe' so c before d
    const board = room.snapshotLeaderboard()
    expect(board.map((e) => e.id)).toEqual(['b', 'a', 'c', 'd'])
  })
})
```

- [ ] **Step 2: Run the new tests**

Run: `pnpm --filter server test -- -t "leaderboard snapshot"`
Expected: the `includes every connected player` test passes (already true after
Task 2). The sort test should also pass IF the comparator already handles ties
correctly. If it fails, fix the comparator in `snapshotLeaderboard`.

Note: the comparator was added in Task 2 — this task is mostly a **pinning**
test. If both pass on the first run, that's fine — it's still a valuable
contract test.

- [ ] **Step 3: Confirm the full suite is green**

Run: `pnpm --filter server test`
Expected: all tests pass (now 63).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/game/game-room.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): pin leaderboard sort + zero-pt visibility

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Gateway — attach leaderboard to `game-ended`

Both end branches (`arrival` and `all-dead`) now ship the leaderboard.

**Files:**

- Modify: `apps/server/src/game/game.gateway.ts:178-191` (the tick loop's
  game-end emission block)

- [ ] **Step 1: Update the emission block**

In `game.gateway.ts`, find the existing tick-loop branch:

```ts
const result = room.tickAndCheckWinner()
this.server.to(code).emit('state', room.snapshotState())
if (result) {
  this.stopTickLoop(code)
  if (result.reason === 'arrival') {
    this.server.to(code).emit('game-ended', {
      reason: 'arrival',
      winnerId: result.winnerId,
      winnerUsername: room.usernameFor(result.winnerId),
    })
  } else {
    this.server.to(code).emit('game-ended', { reason: 'all-dead' })
  }
  this.broadcastLobby(code)
}
```

Replace with:

```ts
const result = room.tickAndCheckWinner()
this.server.to(code).emit('state', room.snapshotState())
if (result) {
  this.stopTickLoop(code)
  const leaderboard = room.snapshotLeaderboard()
  if (result.reason === 'arrival') {
    this.server.to(code).emit('game-ended', {
      reason: 'arrival',
      winnerId: result.winnerId,
      winnerUsername: room.usernameFor(result.winnerId),
      leaderboard,
    })
  } else {
    this.server.to(code).emit('game-ended', {
      reason: 'all-dead',
      leaderboard,
    })
  }
  this.broadcastLobby(code)
}
```

- [ ] **Step 2: Verify the gateway compiles**

Run: `pnpm --filter server build 2>&1 | tail -20`
Expected: exits 0. (If you don't want to build the full Nest app, just run
the test suite — it imports the same files.)

Alternative: `pnpm --filter server test` — exits 0, 63 tests passing.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/game/game.gateway.ts
git commit -m "$(cat <<'EOF'
feat(server): attach leaderboard to game-ended payload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Client — forward leaderboard from `GameScene` to `EndScene`

`onGameEnded` already routes on `reason`. Pipe through the new `leaderboard`
field on both branches.

**Files:**

- Modify: `apps/client/src/scenes/GameScene.ts:388-403` (`onGameEnded`)
- Modify: `apps/client/src/scenes/EndScene.ts:11-22` (`EndSceneParams`)

- [ ] **Step 1: Extend `EndSceneParams` to accept the leaderboard**

In `EndScene.ts`, find the existing discriminated `EndSceneParams` (the union
of `arrival` and `all-dead` introduced in the previous all-dead change).
Add the `leaderboard` field to both branches:

```ts
import type { LeaderboardEntry, LobbyStatePayload } from '@hips/shared'
```

```ts
export type EndSceneParams =
  | {
      reason: 'arrival'
      won: boolean
      code: string | null
      winnerUsername: string
      leaderboard: LeaderboardEntry[]
    }
  | {
      reason: 'all-dead'
      code: string | null
      leaderboard: LeaderboardEntry[]
    }
```

(Replace the existing `import type { LobbyStatePayload } from '@hips/shared'`
line to merge `LeaderboardEntry` into the same import.)

- [ ] **Step 2: Forward the leaderboard from `GameScene`**

In `GameScene.ts`, find `onGameEnded`:

```ts
  private onGameEnded(payload: GameEndedPayload): void {
    if (payload.reason === 'all-dead') {
      void this.game.sceneManager.goTo(new EndScene(this.game), {
        reason: 'all-dead',
        code: this.roomCode,
      })
      return
    }
    const won = payload.winnerId === this.game.net.id
    void this.game.sceneManager.goTo(new EndScene(this.game), {
      reason: 'arrival',
      won,
      code: this.roomCode,
      winnerUsername: payload.winnerUsername ?? '',
    })
  }
```

Replace with:

```ts
  private onGameEnded(payload: GameEndedPayload): void {
    if (payload.reason === 'all-dead') {
      void this.game.sceneManager.goTo(new EndScene(this.game), {
        reason: 'all-dead',
        code: this.roomCode,
        leaderboard: payload.leaderboard,
      })
      return
    }
    const won = payload.winnerId === this.game.net.id
    void this.game.sceneManager.goTo(new EndScene(this.game), {
      reason: 'arrival',
      won,
      code: this.roomCode,
      winnerUsername: payload.winnerUsername ?? '',
      leaderboard: payload.leaderboard,
    })
  }
```

- [ ] **Step 3: Verify client typecheck**

Run: `pnpm --filter client typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/scenes/GameScene.ts apps/client/src/scenes/EndScene.ts
git commit -m "$(cat <<'EOF'
feat(client): forward leaderboard from GameScene to EndScene

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: EndScene — two-column layout + leaderboard rendering

Reflow the scene into two columns and render the ranking on the right.

**Files:**

- Modify: `apps/client/src/scenes/EndScene.ts` (the entire `onEnter`/`resize` /
  `onLobbyState` bodies and the class fields)

- [ ] **Step 1: Add the leaderboard column field**

At the top of the class, alongside the existing fields, add:

```ts
  private leaderboardContainer: Container | null = null
  private leaderboardEntries: LeaderboardEntry[] = []
```

Update the `pixi.js` import to also bring in `Container`:

```ts
import { Container, Text } from 'pixi.js'
```

- [ ] **Step 2: Replace `onEnter` to compute the left-column anchor and render the leaderboard**

Find the current `onEnter` (the one that handles both `reason` branches).
Replace it with:

```ts
  onEnter(params?: unknown): void {
    const typed = params as EndSceneParams | undefined
    this.roomCode = typed?.code ?? null
    this.leaderboardEntries = typed?.leaderboard ?? []
    const { canvasWidth, canvasHeight } = this.game.layout
    const leftX = canvasWidth * 0.3
    const allDead = typed?.reason === 'all-dead'
    const won = typed?.reason === 'arrival' ? typed.won : false
    const winnerUsername =
      typed?.reason === 'arrival' ? typed.winnerUsername : ''
    const titleText = allDead ? 'Vous êtes tous morts !' : won ? 'Gagné !' : 'Perdu'
    const titleFontSize = allDead ? 56 : 80

    this.message = new Text({
      text: titleText,
      style: { fill: 0xfff700, fontSize: titleFontSize, fontFamily: 'Space Mono, monospace' },
    })
    this.message.anchor.set(0.5)
    this.message.position.set(leftX, canvasHeight / 2 - 60)
    this.message.alpha = 0
    this.message.scale.set(0.4)
    this.addChild(this.message)

    this.subtitle = new Text({
      text: winnerUsername ? `${winnerUsername} a gagné` : '',
      style: { fill: 0xffffff, fontSize: 24, fontFamily: 'Space Mono, monospace' },
    })
    this.subtitle.anchor.set(0.5)
    this.subtitle.position.set(leftX, canvasHeight / 2 + 10)
    this.addChild(this.subtitle)

    this.buildLeaderboard()

    this.lobbyHandler = (payload) => this.onLobbyState(payload)
    this.game.net.on('lobby-state', this.lobbyHandler)
  }
```

- [ ] **Step 3: Add the `buildLeaderboard` method**

Below `onEnter`, add:

```ts
  private buildLeaderboard(): void {
    if (this.leaderboardEntries.length === 0) return
    const { canvasWidth, canvasHeight } = this.game.layout
    const rightX = canvasWidth * 0.7

    const container = new Container()
    container.position.set(rightX, canvasHeight / 2)

    const header = new Text({
      text: 'Classement',
      style: {
        fill: 0xfff700,
        fontSize: 28,
        fontFamily: 'Space Mono, monospace',
        fontWeight: 'bold',
      },
    })
    header.anchor.set(0.5, 1)
    // Sit the header above the first row. Row layout below is row-centred
    // around y=0,1,2…, so the header at y = -firstRowY - header gap.
    const rowSpacing = 28
    const firstRowY = -(this.leaderboardEntries.length - 1) * (rowSpacing / 2)
    header.position.set(0, firstRowY - 24)
    container.addChild(header)

    // Column offsets (relative to the container's centre).
    const rankX = -160
    const nameX = -120
    const ptsX = 60
    const deltaX = 130

    this.leaderboardEntries.forEach((entry, i) => {
      const y = firstRowY + i * rowSpacing
      const rank = new Text({
        text: `${i + 1}.`,
        style: { fill: 0xffffff, fontSize: 20, fontFamily: 'Space Mono, monospace' },
      })
      rank.anchor.set(0, 0.5)
      rank.position.set(rankX, y)

      const name = new Text({
        text: entry.username,
        style: { fill: 0xffffff, fontSize: 20, fontFamily: 'Space Mono, monospace' },
      })
      name.anchor.set(0, 0.5)
      name.position.set(nameX, y)

      const pts = new Text({
        text: `${entry.total} pts`,
        style: {
          fill: 0xfff700,
          fontSize: 20,
          fontFamily: 'Space Mono, monospace',
          fontWeight: 'bold',
        },
      })
      pts.anchor.set(0, 0.5)
      pts.position.set(ptsX, y)

      const delta = new Text({
        text: `(+${entry.lastDelta})`,
        style: {
          fill: entry.lastDelta > 0 ? 0x69f0ae : 0x888888,
          fontSize: 18,
          fontFamily: 'Space Mono, monospace',
        },
      })
      delta.anchor.set(0, 0.5)
      delta.position.set(deltaX, y)

      container.addChild(rank, name, pts, delta)
    })

    this.addChild(container)
    this.leaderboardContainer = container
  }
```

- [ ] **Step 4: Move the replay button / hint to the left column**

Find `onLobbyState`. Replace the existing button/hint positioning lines so
they anchor to `leftX = canvasWidth * 0.3` instead of `canvasWidth / 2`. The
relevant patch:

```ts
  private onLobbyState(payload: LobbyStatePayload): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const leftX = canvasWidth * 0.3
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)

    if (payload.status === 'waiting') {
      void this.game.sceneManager.goTo(new GameScene(this.game), {
        initialLobby: payload,
        code: this.roomCode,
      })
      return
    }

    if (this.replayBtn || this.hint) return
    if (isHost) {
      const btn = new Button({
        label: 'Rejouer',
        onClick: () => this.game.net.emit('replay'),
      })
      btn.position.set(leftX, canvasHeight / 2 + 80)
      this.addChild(btn)
      this.replayBtn = btn
    } else {
      const hint = new Text({
        text: "En attente d'une nouvelle partie…",
        style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
      })
      hint.anchor.set(0.5)
      hint.position.set(leftX, canvasHeight / 2 + 80)
      this.addChild(hint)
      this.hint = hint
    }
  }
```

- [ ] **Step 5: Update `resize` to reposition the leaderboard + left-column elements**

Replace the existing `resize` body:

```ts
  override resize(_layout: Layout): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const leftX = canvasWidth * 0.3
    this.message?.position.set(leftX, canvasHeight / 2 - 60)
    this.subtitle?.position.set(leftX, canvasHeight / 2 + 10)
    this.replayBtn?.position.set(leftX, canvasHeight / 2 + 80)
    this.hint?.position.set(leftX, canvasHeight / 2 + 80)
    if (this.leaderboardContainer) {
      this.leaderboardContainer.position.set(canvasWidth * 0.7, canvasHeight / 2)
    }
  }
```

- [ ] **Step 6: Verify client typecheck**

Run: `pnpm --filter client typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 7: Manual smoke test**

Spec is UI-centric for this task — automated tests don't cover Pixi rendering.
Run the dev stack and open two browser windows.

Terminal A: `pnpm --filter server start:dev` (or the project's existing run
command — check `package.json` if unsure).
Terminal B: `pnpm --filter client dev`

Then open two tabs on the printed client URL (likely http://localhost:5173).
Tab 1 creates a room, tab 2 joins with the printed code. Both start the
game. To trigger a leaderboard:

- **Arrival**: walk one player to the right edge → "Gagné !" / "Perdu" on
  the left, leaderboard on the right shows the winner at top with +7 (and
  +2 for any kill along the way).
- **All-dead**: shoot each other → "Vous êtes tous morts !" on the left,
  leaderboard on the right with the killer at top (+2 per kill).

Verify by eye:

- ✓ Title and Rejouer button (or "En attente…" hint on the non-host tab)
  sit on the **left half**, vertically centred.
- ✓ Leaderboard on the **right half**, "Classement" header in yellow,
  rows aligned in columns.
- ✓ Yellow `total pts`, green `(+X)` when `lastDelta > 0`, grey `(+0)`.
- ✓ Click Rejouer → game restarts, next end shows updated totals plus a
  fresh per-round delta.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/scenes/EndScene.ts
git commit -m "$(cat <<'EOF'
feat(client): two-column EndScene with leaderboard on the right

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all 8 tasks, run the full battery:

```bash
pnpm --filter @hips/shared build
pnpm --filter server test
pnpm --filter client typecheck
```

All three commands should exit 0. Server tests count: 63.

Manual smoke test (Task 8 Step 7) must have been performed. UI changes
cannot be verified automatically.
