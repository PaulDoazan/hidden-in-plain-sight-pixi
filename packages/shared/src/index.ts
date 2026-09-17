// Single-file shared package. Concerns are kept side-by-side intentionally:
// - World constants (coords, tick rate, speeds)
// - Zombie + game-state types
// - Socket event payload types and event maps
//
// Why single file: the CommonJS output of TS `export * from`/`export { … } from`
// uses `Object.defineProperty(exports, …)` re-exports that esbuild's static
// CJS lexer (used by Vite's optimizeDeps) does not surface as named ESM
// exports — so the browser side ends up with `does not provide an export
// named 'X'` errors. A single source file emits direct `exports.X = X`
// statements, which esbuild detects and re-exports cleanly.

// ─── World constants ──────────────────────────────────────────────────────

export const WORLD_WIDTH = 1920
export const WORLD_HEIGHT = 886

// Margin from the right edge to the dashed arrival line, in world units.
export const ARRIVAL_LINE_MARGIN = 80
export const ARRIVAL_LINE_X = WORLD_WIDTH - ARRIVAL_LINE_MARGIN

export const SERVER_TICK_HZ = 30

// Movement speeds are expressed in px/frame at a 60 FPS reference, matching
// the existing client tuning. The server scales them to its tick rate via
// `pxPerTick = pxPerFrame * (60 / SERVER_TICK_HZ)`.
export const WALK_SPEED = 0.8
export const RUN_SPEED = 2.2

// Spawn positions: every zombie (players + bots) spawns in this narrow x band
// near the left side. The left offset leaves room for the bottom-left mobile
// control buttons so they never sit on top of a spawned zombie; on desktop it
// is just empty ground. The 20-unit width gives enough jitter to avoid a
// perfectly straight line without breaking the "lined up at the start" feel.
export const SPAWN_BAND_X = 180
export const SPAWN_BAND_WIDTH = 20

// ─── Zombie + game-state types ────────────────────────────────────────────

export type ZombieType = 'man' | 'woman' | 'wild'
export type ZombieAnimation = 'walk' | 'idle' | 'die' | 'run'

export interface GameConfig {
  numBots: number
  walkSpeed: number
  runSpeed: number
  bulletsPerPlayer: number
  playAreaRatio: number
}

export interface ZombieState {
  id: string
  type: ZombieType
  x: number
  y: number
  animation: ZombieAnimation
  isAlive: boolean
}

// ─── Socket protocol ──────────────────────────────────────────────────────

export interface PlayerState extends ZombieState {
  bulletsRemaining: number
  // Per-player crosshair color, picked from a fixed palette at spawn time.
  color: number
  // World-space pointer position broadcast to all peers so each client can
  // render every other player's crosshair.
  pointer: { x: number; y: number }
  username: string
}

// Hard cap on stored username length. Trimmed and sliced server-side so a
// hostile client can't bloat the lobby payload.
export const USERNAME_MAX_LENGTH = 20

// Server-driven background zombies — the "hide among them" camouflage of the
// original game. Visually indistinguishable from players: same sprites, same
// walk/idle animations. No crosshair, no pointer, no bullets.
export type BotState = ZombieState

// Number of background bots spawned at game start.
export const BOT_COUNT = 20

export type RoomStatus = 'waiting' | 'running' | 'ended'

export interface InputPayload {
  keys: { space: boolean; shift: boolean }
  pointer: { x: number; y: number } // world coordinates
}

export interface FirePayload {
  pointer: { x: number; y: number } // world coordinates
  // Per-client zombie hitbox scale. The server multiplies its base AABB by
  // this factor so a hit registered visually on the shooter's screen also
  // counts on the server (which doesn't know per-viewport rendering scale).
  scale: number
}

export interface LobbyStatePayload {
  players: { id: string; isHost: boolean; username: string }[]
  status: RoomStatus
}

export interface GameStartedPayload {
  players: PlayerState[]
  bots: BotState[]
  arrivalLineX: number
}

export interface StatePayload {
  players: PlayerState[]
  bots: BotState[]
}

export interface ShotFiredPayload {
  shooterId: string
  origin: { x: number; y: number }
  hit: { targetId: string } | null
}

export interface PlayerKilledPayload {
  id: string
  // Present only when the killed entity is a real player (not a bot). Used by
  // the client to surface a "X est mort" banner; bots die silently.
  username?: string
  // Username of the player who fired the killing shot. Set only when both
  // shooter and victim are real players — used by the client to surface the
  // "BANG ! A a tué B" kill-feed banner.
  killerUsername?: string
  // Socket id of the killer, set under the same condition as killerUsername.
  // The client compares it against its own id to show the "+1 balle" reward
  // flash. It can't infer the reward from `bulletsRemaining` instead: the
  // server spends and refunds the bullet inside a single `fire()` call, so
  // the count never changes between two snapshots.
  killerId?: string
}

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
  leaderboard?: LeaderboardEntry[]
}

export interface PlayerLeftPayload {
  id: string
}

export interface CreateRoomPayload {
  username: string
}

export interface JoinRoomPayload {
  code: string
  username: string
}

export interface RoomCreatedPayload {
  code: string
  lobby: LobbyStatePayload
}

export interface RoomJoinedPayload {
  code: string
  lobby: LobbyStatePayload
}

export type RoomJoinFailReason = 'not-found' | 'already-in-room'

export interface RoomJoinFailedPayload {
  reason: RoomJoinFailReason
}

// Client → Server
export interface ClientToServerEvents {
  'create-room': (payload: CreateRoomPayload) => void
  'join-room': (payload: JoinRoomPayload) => void
  start: () => void // host only, valid in `waiting`
  replay: () => void // host only, valid in `ended` — resets to `waiting`
  input: (payload: InputPayload) => void
  fire: (payload: FirePayload) => void
}

// Server → Client
export interface ServerToClientEvents {
  'room-created': (payload: RoomCreatedPayload) => void
  'room-joined': (payload: RoomJoinedPayload) => void
  'room-join-failed': (payload: RoomJoinFailedPayload) => void
  'lobby-state': (payload: LobbyStatePayload) => void
  'game-started': (payload: GameStartedPayload) => void
  state: (payload: StatePayload) => void // 30 Hz
  'shot-fired': (payload: ShotFiredPayload) => void
  'player-killed': (payload: PlayerKilledPayload) => void
  'game-ended': (payload: GameEndedPayload) => void
  'player-left': (payload: PlayerLeftPayload) => void
}
