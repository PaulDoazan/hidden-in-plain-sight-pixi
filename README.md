# Hidden in Plain Sight — PixiJS rewrite

PixiJS v8 + TypeScript port of the original CreateJS game *« Marche ou crève »*.

A solo player controls one zombie hidden among bots. Aim with the mouse, fire your single bullet, run to the finish line on the right to win.

## Stack

- **Client:** PixiJS v8, Vite, TypeScript
- **Server (placeholder for Phase 2):** NestJS
- **Monorepo:** pnpm workspaces
- **Containers:** Docker Compose

## Phasing

| Phase | Status | Scope |
|-------|--------|-------|
| 1 | in progress | Solo sandbox client, monorepo bootstrap |
| 2 | planned | Multiplayer via NestJS WebSocket gateway, room codes |
| 3 | planned | Mobile / touch version |

## Local dev

```bash
nvm use
pnpm install
pnpm dev:client
```

Then open http://localhost:5173.

## Controls (Phase 1)

| Action | Input |
|--------|-------|
| Aim | Move the mouse |
| Shoot (one bullet only) | Left-click |
| Walk forward | Hold `Space` |
| Run forward | Hold `Shift` + `Space` |

Win condition: cross the dashed line on the right of the play area.

## Layout

| Topic | Path |
|-------|------|
| Spec | `docs/superpowers/specs/` |
| Implementation plan | `docs/superpowers/plans/` (in source repo) |
| Client | `apps/client` |
| Server | `apps/server` |
| Shared types | `packages/shared` |

## Phase 1 status

Implemented:

- Monorepo bootstrapped (pnpm workspaces, ESLint, Prettier, Vitest)
- NestJS placeholder (`apps/server`) returning `{ status: 'ok', phase: 1 }`
- PixiJS v8 client with Home / Loading / Game / End scenes
- Solo sandbox gameplay: 1 player + 20 bots, mouse aim, single bullet, walk/run controls, arrival line victory
- Asset pipeline copying spritesheets from the original CreateJS project
- Docker Compose setup (`client` + `server` dev services)

Not yet:

- Networking / multiplayer (Phase 2)
- Mobile / touch (Phase 3)
- Audio
- Real responsive sprite scaling on extreme aspect ratios
