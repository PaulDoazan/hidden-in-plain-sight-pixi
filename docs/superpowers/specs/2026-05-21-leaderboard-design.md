# End-of-round leaderboard

## Goal

At the end of every game (winner crossing the line _or_ all-dead), display a
ranking next to the existing end-game UI (title, subtitle, Rejouer button or
waiting hint). The ranking accumulates across `Rejouer` cycles in the same
room, and shows each player's pseudo, total points, and the delta won during
the round that just finished.

## Scoring rules

| Event                       | Points awarded                      |
| --------------------------- | ----------------------------------- |
| Killing another real player | +2 to the shooter                   |
| Crossing the arrival line   | +7 to the player who crossed        |
| Killing a bot               | 0 (bots are not in the leaderboard) |
| Dying (any cause)           | 0                                   |

Notes:

- A dead shooter can still score: the existing fire pipeline lets a dead player
  take revenge, and that revenge counts for points too. This is intentional —
  matches the existing combat rules.
- Self-kills are already excluded by `fire()` (shooter filtered out of
  candidates). No additional guard needed.

## Accumulation and reset

- **Persists across `replay()`** : totals are kept between Rejouer cycles. Only
  the `lastDelta` of every existing score-map entry is reset to 0 when a new
  round starts, so the `(+X)` indicator reflects strictly the round that just
  finished. Players who have not yet scored have no entry; they get one only
  when they first earn points.
- **Removed on disconnect** : `removePlayer()` drops the player's entry. This
  matches the existing behaviour — a disconnected player disappears from
  every other view, the leaderboard should follow suit.
- **Reset when the room empties** : `GameRoomService` is destroyed by
  `RoomRegistry` when the last socket leaves; the scores die with it. No
  separate TTL.

## Sort order

Stable, deterministic:

1. `total` descending
2. `lastDelta` descending (recent activity breaks ties)
3. `username` ascending (alphabetical, last-resort tiebreaker)

## Wire format

New shared type:

```ts
export interface LeaderboardEntry {
  id: string
  username: string
  total: number
  lastDelta: number
}
```

`GameEndedPayload` gains a `leaderboard: LeaderboardEntry[]` field, already
sorted by the server. Sent verbatim on both end conditions (`arrival` and
`all-dead`).

## Server changes

- `GameRoomService` gains:
  - `private readonly scores = new Map<string, { total: number; lastDelta: number }>()`
  - `private creditPoints(id: string, points: number)` helper — adds to `total`
    and `lastDelta` in one go. Used by `fire()` for kills and by
    `tickAndCheckWinner()` for arrival.
  - `snapshotLeaderboard(): LeaderboardEntry[]` — iterates over `playerOrder`
    (every currently-connected player), looks up the score map (defaulting
    to `{ total: 0, lastDelta: 0 }` if absent), joins with the username,
    sorts, and returns. So a player who has never scored still appears at
    the bottom of the leaderboard with `0 pts (+0)`. Called by the gateway
    when emitting `game-ended`.
  - `replay()` extended: clears game state as before, plus zeroes every
    player's `lastDelta`. Totals are untouched.
- `fire()` awards +2 to the shooter when the hit entity is a real player. Bot
  kills give 0. Detected via `this.players.has(hit.id)`.
- `tickAndCheckWinner()` awards +7 to the winner just before returning
  `{ reason: 'arrival', winnerId }`. No points awarded in the all-dead branch.
- `removePlayer()` deletes the player's score entry alongside the rest.

## Gateway changes

`startTickLoop()` attaches `leaderboard: room.snapshotLeaderboard()` to the
`game-ended` payload in both branches (`arrival` and `all-dead`).

## Client changes

**`GameScene.onGameEnded`** forwards the `leaderboard` to `EndScene` via the
existing scene params (added as a required field on both variants).

**`EndScene` layout** :

The scene currently centres the title (anchor `canvasWidth / 2`), subtitle
just below, and the replay button / waiting hint at `canvasHeight / 2 + 80`.

New layout splits the scene into two columns:

- **Left column** (centred around `canvasWidth * 0.3`): existing title,
  subtitle, and replay button or waiting hint. Same vertical arrangement.
- **Right column** (centred around `canvasWidth * 0.7`): leaderboard table,
  vertically centred at `canvasHeight / 2`.

Leaderboard rendering:

- One header line "Classement" in jaune `0xfff700`, fontSize 28, bold.
- One row per `LeaderboardEntry`, layout: `1.  Antoine    23 pts  (+9)`
- Row text styling:
  - rank + dot: white, fontSize 20
  - username: white, fontSize 20
  - `XX pts`: jaune `0xfff700`, fontSize 20, bold
  - `(+X)`: green `0x69f0ae` if `lastDelta > 0`, gris `0x888888` if 0,
    fontSize 18. Always present so the column width is stable.
- Row spacing: 28 px.
- Layout uses fixed column offsets relative to the column centre so columns
  line up across rows even with proportional fonts.

Responsive behaviour: out of scope. Targeted at desktop. If the canvas is too
narrow (mobile), the two columns will overlap — accepted for now; revisit
only if it becomes a real problem in playtests.

## Edge cases

- **Solo game ending in all-dead** : leaderboard has one entry, `total = 0`,
  `lastDelta = 0`. Displayed normally.
- **Replay after all-dead** : `replay()` zeroes `lastDelta` like always. Totals
  are kept (which means the next round's first kill makes that player jump
  to the top — desired).
- **Host disconnect mid-game** : the existing `removePlayer()` path drops the
  host. Score map entry is removed alongside. If a real player remains, the
  game continues; on next game-end the leaderboard will not include the
  disconnected ex-host.

## Tests (server)

New tests in `game-room.service.spec.ts`:

1. Killing another player awards +2 to the shooter, `lastDelta` reflects it.
2. Killing a bot awards 0 points.
3. Crossing the arrival line awards +7 to the winner.
4. All-dead end awards no extra points.
5. `replay()` keeps totals, zeroes `lastDelta`.
6. `removePlayer()` drops the disconnected player's score entry.
7. `snapshotLeaderboard()` sorts by total desc, then lastDelta desc, then
   username asc — a fixture with deliberate ties exercises all three keys.

Existing tests that assert `tickAndCheckWinner`'s return shape need no change
— the return value is still `{ reason: 'arrival', winnerId }` and the +7 is
a side-effect on the internal score map, verified via `snapshotLeaderboard`.

## Out of scope

- Persisting scores across browser refreshes or socket re-connections.
- Cross-room leaderboards.
- Mid-game leaderboard preview.
- Mobile / responsive layout for the two-column EndScene.
- Live kill-feed score updates (already covered by the BANG banner).
