# Start-of-round bonus draft

## Goal

Before every round, each player picks one bonus out of three drawn at random
from a catalogue of six. The pick is private: other players see only that you
have picked, never what. Bonuses change how a round plays out — an extra
bullet, a second life, a bomb that thins out the camouflage — and are redrawn
at the start of every round, so a series of games in the same room never
repeats the same loadout.

## Round lifecycle

`RoomStatus` gains a `drafting` state:

```
waiting --host "start"--> drafting --all picked | 15s timeout--> running --> ended
   ^                                                                          |
   +------------------------------- replay() -------------------------------- +
```

Spawning moves from `start()` to the end of the draft. Two passive bonuses
(Magazine, Sprint) change a player's starting state, and applying them to a
freshly spawned player is simpler than spawning first and patching afterwards.

| Method                         | Guard                                                                     | Effect                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `start(requesterId)`           | status `waiting`, requester is host, room not empty                       | Draws one 3-card offer per player, status → `drafting`, returns the offers                                                    |
| `pickBonus(playerId, bonusId)` | status `drafting`, bonus is in that player's offer, player has not picked | Records the pick, returns whether the draft is now complete                                                                   |
| `resolveDraft()`               | status `drafting`                                                         | Auto-picks for stragglers, spawns players + bots, runs `onRoundStart` hooks, status → `running`, returns `GameStartedPayload` |

The 15 s timer lives in the gateway next to `tickHandles`, as a
`draftHandles: Map<code, Timeout>` with the same lifecycle (cleared on
resolve, on empty room, on room removal). On timeout, a straggler gets a
random card among the three offered — not the first, which would make the
same bonus over-selected by AFK players.

Offers are drawn independently per player: three distinct bonuses out of six,
and two players may be offered — and pick — the same bonus.

A socket that joins a room mid-draft gets no offer (it has no `PlayerState`
until the next `start()` either). It waits in the lobby, as today.

## Catalogue

| Id           | Name               | Kind    | Effect                                                                                                                                                                                                                | Revealed |
| ------------ | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `bomb`       | Bombe              | active  | Kills `max(1, ceil(aliveBots * 0.2))` random bots, capped by how many are alive. Players are never hit.                                                                                                               | Yes      |
| `extra-life` | Seconde vie        | passive | On a lethal hit: swap position and `type` with a random alive bot, and that bot dies at the player's former position. The shooter is treated as having killed a bot. Falls back to a normal death if no bot is alive. | No       |
| `vest`       | Gilet              | passive | The first lethal hit is absorbed; the player stays alive where they stand. The shooter still spends the bullet, earns no points and gets no refund.                                                                   | Yes      |
| `skin-swap`  | Changement de peau | active  | Swap position and `type` with a random alive bot. Both stay alive.                                                                                                                                                    | No       |
| `magazine`   | Chargeur           | passive | `bulletsRemaining += 1` at spawn.                                                                                                                                                                                     | No       |
| `sprint`     | Sprint             | passive | Run speed × 1.35. Walk speed unchanged.                                                                                                                                                                               | No       |

Active bonuses have one charge. `vest` and `extra-life` have one charge too:
a second lethal hit kills.

### Reveal rule

A bonus is revealed (broadcast `bonus-used` → kill-feed banner) only when
somebody would otherwise be left confused:

- **Bombe** — twenty bots collapsing at once is public by nature. Banner:
  `💣 Antoine a lâché une bombe`.
- **Gilet** — the shooter saw their target survive a hit and needs the
  explanation. Banner: `🛡️ Marie a encaissé le tir`. The cost is symmetric:
  the banner also outs Marie as a human, which is what keeps the vest fair.
- **Seconde vie** — silent. The body swap kills a bot at the player's old
  position, so the shooter sees a zombie fall exactly where they aimed and
  has no reason to suspect anything. Announcing it would destroy the illusion.
- **Changement de peau** — silent. It is an escape tool; revealing it would
  defeat its purpose.
- **Chargeur**, **Sprint** — invisible, nothing to announce.

## Protocol

New types in `packages/shared/src/index.ts`:

```ts
export type BonusId = 'bomb' | 'extra-life' | 'vest' | 'skin-swap' | 'magazine' | 'sprint'

export type BonusKind = 'passive' | 'active'

// Presentation metadata lives in shared so the client renders draft cards and
// HUD icons without keeping its own copy of the catalogue in sync.
export interface BonusInfo {
  id: BonusId
  name: string
  description: string
  icon: string
  kind: BonusKind
}

export const BONUS_INFO: Record<BonusId, BonusInfo>
export const BONUS_IDS: BonusId[]
export const BONUS_OFFER_SIZE = 3
export const DRAFT_DURATION_MS = 15_000

export interface BonusDraftStartedPayload {
  offer: BonusId[]
  durationMs: number
}

export interface BonusDraftProgressPayload {
  pickedIds: string[]
}

export interface PickBonusPayload {
  bonusId: BonusId
}

export interface BonusUsedPayload {
  playerId: string
  username: string
  bonusId: BonusId
}
```

Event map additions:

| Direction | Event                  | Delivery       | Payload                     |
| --------- | ---------------------- | -------------- | --------------------------- |
| S→C       | `bonus-draft-started`  | per socket     | `BonusDraftStartedPayload`  |
| S→C       | `bonus-draft-progress` | room broadcast | `BonusDraftProgressPayload` |
| S→C       | `bonus-used`           | room broadcast | `BonusUsedPayload`          |
| C→S       | `pick-bonus`           | —              | `PickBonusPayload`          |
| C→S       | `use-bonus`            | —              | none                        |

`bonus-draft-started` is emitted socket by socket so each client learns only
its own three cards.

`PlayerState` is deliberately left untouched. Carrying the chosen bonus there
would leak it to every client in each 30 Hz snapshot, which contradicts the
private-pick rule. A client knows its own bonus because it picked it, and
learns the charge is spent from the matching `bonus-used`. The server stays
authoritative either way.

`use-bonus` carries no payload: the server already knows which bonus the
socket drafted and whether a charge remains.

## Server structure

### `apps/server/src/game/room-state.ts` (new)

Holds `PlayerInternalState` and `BotInternalState`, which both the room and
the bonus registry need. Without this file the registry would import from
`game-room.service.ts` while the service imports the registry — a cycle.

```ts
export interface PlayerInternalState extends PlayerState {
  bonus: BonusId | null
  bonusCharges: number
  runMultiplier: number
}
```

`snapshotState()` strips `bonus`, `bonusCharges` and `runMultiplier` the same
way `snapshotBots()` already strips `canMove` and `countTick`.

### `apps/server/src/game/bonuses.ts` (new)

The declarative registry. One entry per bonus, at most three hooks each:

```ts
export interface BonusContext {
  player: PlayerInternalState
  alivePlayers: () => PlayerInternalState[]
  aliveBots: () => BotInternalState[]
  rng: () => number
}

export interface BonusDefinition {
  id: BonusId
  kind: BonusKind
  // Spawn-time effect. Magazine, Sprint.
  onRoundStart?: (ctx: BonusContext) => void
  // Player pressed the trigger. Bomb, Skin-swap.
  onActivate?: (ctx: BonusContext) => { reveal: boolean }
  // Player took a lethal hit. Vest, Extra life.
  onLethalHit?: (ctx: BonusContext) => { survived: boolean; reveal: boolean }
}

export const BONUS_REGISTRY: Record<BonusId, BonusDefinition>
```

`GameRoomService` never names a bonus. It calls the registry at exactly three
points — spawn, `useBonus()`, and the hit branch of `fire()` — and the
charge accounting (`bonusCharges`) lives in the service, not in the hooks.

### `apps/server/src/game/bonus-draft.ts` (new)

Owns the draw and the pick bookkeeping, independent of the room:

```ts
export class BonusDraft {
  constructor(playerIds: string[], rng: () => number)
  offerFor(playerId: string): BonusId[] | null
  pick(playerId: string, bonusId: BonusId): boolean // false if not offered or already picked
  isComplete(): boolean
  resolve(): Map<string, BonusId> // auto-picks a random offered card for stragglers
  forget(playerId: string): void // player disconnected mid-draft
}
```

### `GameRoomService` changes

- `status` gains `'drafting'`; `fire()`, `applyInput()`, `tick()` and
  `tickAndCheckWinner()` keep their existing `status !== 'running'` guards, so
  nothing moves or shoots during the draft without further work.
- `start()` no longer spawns; it builds a `BonusDraft` and returns the offers.
- `resolveDraft()` does what `start()` used to do (shuffled lineup, stratified
  y, spawn) and then runs `onRoundStart` for each player's bonus.
- `useBonus(playerId)` → `{ bonusId, reveal } | null`. Returns null when the
  status is not `running`, the bonus is passive, or no charge remains. A bomb
  fired with no bot left alive also returns null and keeps its charge, rather
  than burning it on nothing.
- `fire()`'s hit branch: before killing a player target, run `onLethalHit` if
  that target holds a bonus with one. The return shape grows one optional
  field:

  ```ts
  {
    shooterId: string
    origin: { x: number; y: number }
    hit: { targetId: string } | null
    absorbedBy?: { playerId: string; bonusId: BonusId }
  }
  ```

  - **Vest**: the target survives. `hit.targetId` still names the player (the
    shot did connect, so the client shows blood), and `absorbedBy` tells the
    gateway to emit `bonus-used` instead of `player-killed`. No points, no
    bullet refund.
  - **Extra life**: the swap happens inside `fire()`, and `hit.targetId` is
    then the id of the **bot that died in the player's place**. Nothing
    downstream needs a special case: the gateway sees a bot kill, emits a
    username-less `player-killed`, and awards nothing — exactly the illusion
    the bonus is built on.

- `removePlayer()` forgets the player from the draft; the gateway then checks
  whether the remaining players have all picked.
- `replay()` clears the draft and every player's bonus state.

## Gateway changes

- `start` → emit `bonus-draft-started` per socket, `broadcastLobby` (status
  `drafting`), arm the draft timer.
- `pick-bonus` → `room.pickBonus()`, broadcast `bonus-draft-progress`; when
  the draft is complete, clear the timer and resolve.
- Draft resolution (shared by the "all picked" and timeout paths):
  `room.resolveDraft()` → emit `game-started`, `broadcastLobby`,
  `startTickLoop`.
- `use-bonus` → `room.useBonus()`; broadcast `bonus-used` when `reveal` is
  true. The bomb's dead bots need no dedicated event: their `isAlive` flip
  travels in the next state snapshot and the client animates it.
- `fire` → unchanged except for one branch: when `absorbedBy` is set, emit
  `bonus-used` in place of `player-killed`. The second-life case needs no
  branch at all, because `fire()` already reports the swapped bot as the
  victim.
- `handleDisconnect` → clear the draft timer when the room empties, and
  resolve the draft if the leaver was the last one still picking.

## Client changes

### `apps/client/src/ui/BonusDraftOverlay.ts` (new)

Modelled on `WaitingRoomOverlay`: three cards (icon, name, one-line
description), a countdown, and under them the player list with a ✓ as each
one picks. Clicking a card emits `pick-bonus`, freezes the cards and switches
the overlay to "en attente des autres". Rebuilt on resize like its sibling.

### `GameScene`

- Listens to `bonus-draft-started` (swap the waiting overlay for the draft
  overlay), `bonus-draft-progress` (tick the ✓ list) and `bonus-used`
  (reuse the existing kill-feed banner). `game-started` keeps its current
  behaviour and destroys whichever overlay is up.
- Active-bonus trigger: **`B`** on desktop (free — the mouse aims, left click
  fires, Space walks, Space+Shift runs), and a third button in the
  `MobileControls` lower-left column, shown only while the drafted bonus is
  active and unspent.
- HUD gains the bonus icon and its state (charged / spent).

### Body-swap rendering

`PlayerZombie.applyServerState` currently ignores a change of `type`, but
both swap bonuses change a zombie's appearance. `reconcileZombie` must
destroy and rebuild the zombie when the snapshot's `type` differs from the
rendered one.

## Testing

Server (Vitest, mirroring the existing suites):

- `bonus-draft.spec.ts` — offer holds 3 distinct ids, `pick` rejects a bonus
  outside the offer and a second pick, `isComplete` flips only when everyone
  has picked, `resolve` auto-picks from the offer, `forget` unblocks
  completion.
- `game-room.service.spec.ts` — lifecycle (`start` → `drafting`, no spawn
  yet, `fire` rejected while drafting, `resolveDraft` spawns and applies
  passives, `replay` clears bonuses) and one test per effect: bomb kills
  `ceil(20%)` bots and no player, vest absorbs the first hit then dies on the
  second, extra life swaps with a bot and kills that bot in place, magazine
  adds a bullet, sprint multiplies run distance per tick.

Client: no test. The repo has no UI test infrastructure (only `systems/` is
covered).

## Out of scope

- Radar and Départ lancé, considered and dropped: the first works against the
  deduction core of the game, the second is a pure racing perk with no
  decision attached.
- An aimed, thrown bomb. Considered; the global one-key version was chosen.
- Bonus rarity or weighting: all six are drawn with equal probability.
- Persisting a bonus across rounds: every round redraws.
