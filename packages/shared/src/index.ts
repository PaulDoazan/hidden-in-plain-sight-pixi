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

// Points awarded for crossing the arrival line, indexed by finishing rank.
// The gap between 1st and 2nd is deliberately the widest: winning the race
// still pays, but every finisher scores. Ranks past the table all earn the
// last value, so arriving 9th never scores worse than arriving 7th — and
// finishing always beats dying, which is worth 0.
export const ARRIVAL_POINTS = [7, 5, 4, 3, 2, 1] as const

// `rank` is 1-based: the first player across the line is rank 1.
export function arrivalPointsFor(rank: number): number {
  const index = Math.min(Math.max(rank, 1), ARRIVAL_POINTS.length) - 1
  return ARRIVAL_POINTS[index]!
}

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
  // True once the player crossed the arrival line. A finisher is out of the
  // race: safe from bullets, deaf to input, and walking off-screen on its
  // own. The client uses it to drop their crosshair and, for the local
  // player, to switch to spectator mode.
  hasFinished: boolean
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

export type RoomStatus = 'waiting' | 'drafting' | 'running' | 'ended'

// ─── Bonuses ──────────────────────────────────────────────────────────────

export type BonusId =
  | 'bomb'
  | 'extra-life'
  | 'vest'
  | 'skin-swap'
  | 'magazine'
  | 'sprint'
  | 'runaway'
  | 'horde'

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
  runaway: {
    id: 'runaway',
    name: 'Fuyard',
    description: 'À déclencher : un faux zombie part en courant et ne s’arrête plus.',
    icon: '🏃',
    kind: 'active',
  },
  horde: {
    id: 'horde',
    name: 'Horde',
    description: 'À déclencher : dix faux zombies apparaissent autour de toi.',
    icon: '🧟',
    kind: 'active',
  },
}

// Draw order is the declaration order above; tests rely on it.
export const BONUS_IDS = Object.keys(BONUS_INFO) as BonusId[]

// Cards offered to each player at the start of a round, and how long they
// have to pick before the server picks for them.
export const BONUS_OFFER_SIZE = 3
export const DRAFT_DURATION_MS = 15_000

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
  // Host-controlled room setting: the bonuses a round may draw from, in
  // BONUS_IDS order. An offer holds min(BONUS_OFFER_SIZE, length) cards, and
  // an empty list means the round skips the draft entirely. Broadcast to
  // everyone, not just the host, so the whole lobby knows what it is playing.
  enabledBonuses: BonusId[]
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

// A round runs until nobody is still racing — every player has crossed the
// line or died. Game end then has two outcomes:
//   - 'arrival': at least one player finished. `winnerId`/`winnerUsername`
//     identify the *first* one across; the later finishers scored too (see
//     ARRIVAL_POINTS) and show up in the leaderboard.
//   - 'all-dead': nobody made it. No winner; the client shows
//     "Vous êtes tous morts !" instead of the usual win/lose split.
export type GameEndReason = 'arrival' | 'all-dead'
export interface GameEndedPayload {
  reason: GameEndReason
  winnerId?: string
  winnerUsername?: string
  leaderboard?: LeaderboardEntry[]
}

// Broadcast the moment a player crosses the arrival line, while the round is
// still running for everyone else. Carries the rank and points because the
// client cannot derive them: finishers are dropped from the snapshot once
// they walk off the world, so counting `hasFinished` flags would undercount.
export interface PlayerArrivedPayload {
  id: string
  username: string
  rank: number
  points: number
}

export interface PlayerLeftPayload {
  id: string
}

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

export interface SetBonusPayload {
  bonusId: BonusId
  enabled: boolean
}

// Always sent to the owner (their HUD needs to know the charge is spent);
// broadcast to the rest of the room only for a revealed bonus.
export interface BonusUsedPayload {
  playerId: string
  username: string
  bonusId: BonusId
  // Bots the activation killed, so the client can burst an explosion on each
  // corpse. Only the bomb sets it; bot positions are public anyway.
  killedIds?: string[]
}

// Sent to the owner's socket alone, immediately before `game-started`. This
// exists because a client's own click is not a reliable source of truth for
// its bonus: `BonusDraft.resolve()` auto-picks for anyone who didn't click in
// time (or picked after the deadline), so the server's grant can differ from
// whatever the client optimistically set locally. The client must treat this
// event as authoritative and overwrite its local guess unconditionally.
export interface BonusGrantedPayload {
  bonusId: BonusId
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
  'pick-bonus': (payload: PickBonusPayload) => void
  'use-bonus': () => void
  // host only, valid in `waiting` — persists across rounds
  'set-bonus': (payload: SetBonusPayload) => void
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
  'player-arrived': (payload: PlayerArrivedPayload) => void
  'player-left': (payload: PlayerLeftPayload) => void
  'bonus-draft-started': (payload: BonusDraftStartedPayload) => void
  'bonus-draft-progress': (payload: BonusDraftProgressPayload) => void
  'bonus-used': (payload: BonusUsedPayload) => void
  'bonus-granted': (payload: BonusGrantedPayload) => void
}
