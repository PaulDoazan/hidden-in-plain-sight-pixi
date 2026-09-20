# Hidden in Plain Sight — PixiJS rewrite

PixiJS v8 + TypeScript port of the original CreateJS game _« Marche ou crève »_.

A solo player controls one zombie hidden among bots. Aim with the mouse, fire your single bullet, run to the finish line on the right to win.

## Stack

- **Client:** PixiJS v8, Vite, TypeScript
- **Server (placeholder for Phase 2):** NestJS
- **Monorepo:** pnpm workspaces
- **Containers:** Docker Compose

## Phasing

| Phase | Status      | Scope                                                                            |
| ----- | ----------- | -------------------------------------------------------------------------------- |
| 1     | in progress | Solo sandbox client, monorepo bootstrap                                          |
| 2     | in progress | Multiplayer via NestJS WebSocket gateway, room codes, start-of-round bonus draft |
| 3     | planned     | Mobile / touch version                                                           |

## Local dev

```bash
nvm use
pnpm install
pnpm dev:client
```

Then open http://localhost:5173.

## Controls (Phase 1)

| Action                  | Input                              |
| ----------------------- | ---------------------------------- |
| Aim                     | Move the mouse                     |
| Shoot (one bullet only) | Left-click                         |
| Walk forward            | Hold `Space`                       |
| Run forward             | Hold `Shift` + `Space`             |
| Trigger your bonus      | `B` (or the star button on mobile) |

Win condition: cross the dashed line on the right of the play area.

## Scoring

Crossing the line is worth points to **everyone who makes it**, not just the
winner — 7 / 5 / 4 / 3 / 2 / 1 by finishing position, and 1 pt for anyone
arriving after the sixth. Killing another player is worth 2 and refunds the
bullet. Dying before the line is worth nothing.

The round therefore no longer stops at the first arrival: it runs until every
player has either crossed or been killed. A finisher is out of the race —
untargetable, disarmed, deaf to input, their bonus spent or not — and their
zombie simply walks off the right of the screen while the rest of the field
keeps running. The player announced as the winner is the first one across.

The table lives in `packages/shared` (`ARRIVAL_POINTS`), the ranking in
`GameRoomService`.

## Bonus system

Every round opens on a **draft**: each player is offered three bonuses and
picks one. The pick is secret — the others only see that you have chosen. A
player who lets the 15 s timer run out is dealt a random card from their own
offer, and the server tells them which one they got.

The host decides what the room plays with, from the waiting room: eight
checkboxes, persisted across rounds. Tick fewer than three and the offer
shrinks to match; untick everything and the round skips the draft entirely.

| Bonus                 | Kind    | Effect                                                                                                                                              |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 💣 Bombe              | active  | Kills a fifth of the living bots, anywhere on the map. Announced to the room, with a full-screen blast.                                             |
| ❤️ Seconde vie        | passive | The lethal shot swaps you with a random bot, which dies in your place. The shooter sees a body fall where they aimed and is paid as for a bot kill. |
| 🛡️ Gilet              | passive | Absorbs the first lethal hit where you stand. Announced — which also outs you as human.                                                             |
| 🎭 Changement de peau | active  | Swaps your position and appearance with a living bot. Both stay alive, nothing is announced.                                                        |
| 🔫 Chargeur           | passive | Start the round with one extra bullet.                                                                                                              |
| 👟 Sprint             | passive | Run 35 % faster. Walking is unchanged.                                                                                                              |
| 🏃 Fuyard             | active  | Sends a random bot running for the rest of the round — a decoy, since running is what hurried humans do.                                            |
| 🧟 Horde              | active  | Conjures ten bots around you. You give away roughly where you are, then vanish into the crowd you just made.                                        |

A bonus is announced to the room only when somebody would otherwise be
confused by what they just saw. Everything else stays silent: the whole point
of hiding among bots is that nobody can tell what you are holding.

The catalogue lives in `packages/shared` (ids, names, French copy) and the
effects in `apps/server/src/game/bonuses.ts`, a registry of at most three
hooks per bonus — `onRoundStart`, `onActivate`, `onLethalHit`. `GameRoomService`
calls those hooks and never names an individual bonus, so adding a ninth is
one registry entry plus its shared metadata.

## Layout

| Topic               | Path                                       |
| ------------------- | ------------------------------------------ |
| Spec                | `docs/superpowers/specs/`                  |
| Implementation plan | `docs/superpowers/plans/` (in source repo) |
| Client              | `apps/client`                              |
| Server              | `apps/server`                              |
| Shared types        | `packages/shared`                          |

## Phase 1 status

Implemented:

- Monorepo bootstrapped (pnpm workspaces, ESLint, Prettier, Vitest)
- NestJS placeholder (`apps/server`) returning `{ status: 'ok', phase: 1 }`
- PixiJS v8 client with Home / Loading / Game / End scenes
- Solo sandbox gameplay: 1 player + 20 bots, mouse aim, single bullet, walk/run controls, degressive arrival scoring
- Asset pipeline copying spritesheets from the original CreateJS project
- Docker Compose setup (`client` + `server` dev services)

Not yet:

- Mobile / touch polish (Phase 3)
- Audio
- Real responsive sprite scaling on extreme aspect ratios
