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
import {
  ARRIVAL_LINE_X,
  BOT_COUNT,
  RUN_SPEED,
  SERVER_TICK_HZ,
  SPAWN_BAND_WIDTH,
  SPAWN_BAND_X,
  USERNAME_MAX_LENGTH,
  WALK_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '@hips/shared'

import { findNearestHit } from './collision'

const TYPES: ZombieType[] = ['man', 'woman', 'wild']
export const BULLETS_PER_PLAYER = 1

// Fixed crosshair palette. Picked to be highly distinguishable on the dim
// playfield: warm primaries first, then secondaries. Players are assigned
// colors by spawn index, so a refresh keeps the same player on the same
// color across the session.
const CROSSHAIR_PALETTE: number[] = [
  0xff5252, // red
  0x40c4ff, // sky blue
  0xb388ff, // violet
  0x69f0ae, // mint
  0xffd740, // amber
  0xff80ab, // pink
  0x84ffff, // cyan
  0xeeff41, // lime
  0xff9100, // orange
  0xb9f6ca, // pale green
  0xea80fc, // magenta
  0xffffff, // white (fallback for the 12th+ player)
]

// Bot wandering cadence: how many server ticks before flipping between
// walk and idle. Tuned at 30 Hz — original Phase 1 used 40-200 at 60 FPS,
// so we halve to keep the same wall-clock duration.
const BOT_MIN_TICK = 20
const BOT_MAX_TICK = 100

// Vertical placement: every zombie — host included — draws a random y from
// the same band so a real player can't be spotted from their position alone.
// Top limit is two fifths of the world height, matching the dashed arrival
// line; bottom limit leaves a small bottom margin.
const SPAWN_Y_MIN = WORLD_HEIGHT * (2 / 5)
const SPAWN_Y_MAX = WORLD_HEIGHT * 0.9

interface BotInternalState extends BotState {
  canMove: boolean
  countTick: number
}

// Per-room state. Owned and instantiated by RoomRegistry; not a Nest provider.
export class GameRoomService {
  private readonly playerOrder: string[] = []
  // Authoritative username per socket. Set at addPlayer time, persists across
  // start/replay cycles. Cleared on removePlayer.
  private readonly usernames = new Map<string, string>()
  private readonly players = new Map<string, PlayerState>()
  private readonly inputs = new Map<string, InputPayload>()
  private bots: BotInternalState[] = []
  // Per-room cumulative scores. Survives replay() so a series of games in
  // the same room feels like a tournament; cleared when the room empties.
  private readonly scores = new Map<string, { total: number; lastDelta: number }>()
  private status: RoomStatus = 'waiting'
  private static readonly TICK_SCALE = 60 / SERVER_TICK_HZ
  // Default placeholder pre-filled on the client. Treated as "no real name
  // chosen" so the server falls back to "Joueur N" rather than letting every
  // lobby end up full of identical "Joueur" entries.
  private static readonly DEFAULT_USERNAME = 'Joueur'

  // Test hook: injected RNG so spawn/tick are deterministic in unit tests.
  // Defaults to Math.random in production.
  private rng: () => number = Math.random

  setRngForTest(rng: () => number): void {
    this.rng = rng
  }

  addPlayer(id: string, rawUsername = ''): void {
    if (this.playerOrder.includes(id)) return
    this.playerOrder.push(id)
    this.usernames.set(id, this.resolveUsername(rawUsername))
  }

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

  isEmpty(): boolean {
    return this.playerOrder.length === 0
  }

  snapshotLobby(): LobbyStatePayload {
    return {
      players: this.playerOrder.map((id, i) => ({
        id,
        isHost: i === 0,
        username: this.usernames.get(id) ?? '',
      })),
      status: this.status,
    }
  }

  usernameFor(id: string): string {
    return this.usernames.get(id) ?? ''
  }

  // Trim + cap + fallback. Empty or "Joueur" (the client placeholder) is
  // treated as "no real name" and replaced with "Joueur N" where N is the
  // player's 1-based join order in the room. Uniqueness across players is
  // not enforced — two "Antoine" in the same room is allowed.
  private resolveUsername(raw: string): string {
    const trimmed = raw.trim().slice(0, USERNAME_MAX_LENGTH)
    if (trimmed.length === 0 || trimmed === GameRoomService.DEFAULT_USERNAME) {
      return `${GameRoomService.DEFAULT_USERNAME} ${this.playerOrder.length}`
    }
    return trimmed
  }

  start(requesterId: string): GameStartedPayload | null {
    if (this.status !== 'waiting') return null
    if (this.playerOrder.length === 0) return null
    if (this.playerOrder[0] !== requesterId) return null

    this.players.clear()
    this.bots = []

    // Build a single shuffled lineup of all entities — every real player
    // (host included) and every bot — so a real player's spawn position is
    // indistinguishable from a bot's.
    type Slot =
      | { kind: 'player'; id: string; index: number }
      | { kind: 'bot'; index: number }
    const slots: Slot[] = []
    this.playerOrder.forEach((id, i) => {
      slots.push({ kind: 'player', id, index: i })
    })
    for (let i = 0; i < BOT_COUNT; i++) {
      slots.push({ kind: 'bot', index: i })
    }
    this.shuffle(slots)

    for (const slot of slots) {
      if (slot.kind === 'player') {
        this.players.set(slot.id, this.spawnPlayer(slot.id, slot.index))
      } else {
        this.bots.push(this.spawnBot(slot.index))
      }
    }

    this.status = 'running'
    return {
      players: [...this.players.values()],
      bots: this.snapshotBots(),
      arrivalLineX: ARRIVAL_LINE_X,
    }
  }

  // Fisher-Yates using the injected RNG so tests stay deterministic when they
  // seed it.
  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      const tmp = arr[i]!
      arr[i] = arr[j]!
      arr[j] = tmp
    }
  }

  applyInput(id: string, input: InputPayload): void {
    const player = this.players.get(id)
    if (!player) return
    this.inputs.set(id, input)
    // Pointer is surfaced on the player so every snapshot carries the
    // up-to-date crosshair position for remote rendering.
    player.pointer = input.pointer
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
    this.tickBots()
  }

  snapshotState(): StatePayload {
    return {
      players: [...this.players.values()].map((p) => ({ ...p })),
      bots: this.snapshotBots(),
    }
  }

  // Convenience method: tick + end-of-game check, used by the gateway loop.
  // Two end conditions:
  //   - a player crosses the arrival line → that player wins
  //   - every connected player is dead → game ends with no winner
  // Bots never count for either: only entries in `this.players` are inspected.
  tickAndCheckWinner():
    | { reason: 'arrival'; winnerId: string }
    | { reason: 'all-dead' }
    | null {
    if (this.status !== 'running') return null
    this.tick()
    for (const p of this.players.values()) {
      if (p.isAlive && p.x >= ARRIVAL_LINE_X) {
        this.status = 'ended'
        this.creditPoints(p.id, 7)
        return { reason: 'arrival', winnerId: p.id }
      }
    }
    if (this.players.size > 0) {
      let anyAlive = false
      for (const p of this.players.values()) {
        if (p.isAlive) {
          anyAlive = true
          break
        }
      }
      if (!anyAlive) {
        this.status = 'ended'
        return { reason: 'all-dead' }
      }
    }
    return null
  }

  // Test-only helper.
  teleportForTest(id: string, x: number): void {
    const p = this.players.get(id)
    if (p) p.x = x
  }

  // Test-only helper to force a player's bullet count (used to keep the
  // out-of-bullets test meaningful when BULLETS_PER_PLAYER is bumped for dev).
  setBulletsForTest(id: string, count: number): void {
    const p = this.players.get(id)
    if (p) p.bulletsRemaining = count
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

  fire(
    shooterId: string,
    pointer: { x: number; y: number },
    scale = 1,
  ): {
    shooterId: string
    origin: { x: number; y: number }
    hit: { targetId: string } | null
  } | null {
    if (this.status !== 'running') return null
    const shooter = this.players.get(shooterId)
    // Note: dead shooters are intentionally allowed to fire — a player can
    // still take revenge after being killed, per the original game design.
    if (!shooter || shooter.bulletsRemaining <= 0) return null

    shooter.bulletsRemaining -= 1

    const playerCandidates = [...this.players.values()].filter(
      (p) => p.id !== shooterId,
    )
    // Bots share the same hit-detection pipeline (point-in-AABB on the server
    // mirrors the client visual). Wasting a bullet on a bot is part of the
    // gameplay tension: the player loses their only shot for nothing.
    const candidates = [...playerCandidates, ...this.bots]
    const hit = findNearestHit(pointer, candidates, scale)
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
    return {
      shooterId,
      origin: pointer,
      hit: hit ? { targetId: hit.id } : null,
    }
  }

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

  // Test-only helper for asserting bot-related behavior without seeding RNG.
  botsForTest(): readonly BotState[] {
    return this.bots
  }

  private spawnBot(i: number): BotInternalState {
    const cycleRange = BOT_MAX_TICK - BOT_MIN_TICK
    return {
      id: `bot-${i}`,
      type: this.pickType(),
      x: this.spawnX(),
      y: this.spawnY(),
      animation: 'idle',
      isAlive: true,
      canMove: false,
      countTick: Math.floor(this.rng() * cycleRange) + BOT_MIN_TICK,
    }
  }

  private pickType(): ZombieType {
    return TYPES[Math.floor(this.rng() * TYPES.length)]!
  }

  private spawnX(): number {
    return SPAWN_BAND_X + this.rng() * SPAWN_BAND_WIDTH
  }

  private spawnY(): number {
    return SPAWN_Y_MIN + this.rng() * (SPAWN_Y_MAX - SPAWN_Y_MIN)
  }

  private tickBots(): void {
    for (const bot of this.bots) {
      if (!bot.isAlive) {
        bot.animation = 'die'
        continue
      }
      bot.countTick -= 1
      if (bot.countTick <= 0) {
        bot.canMove = !bot.canMove
        const range = BOT_MAX_TICK - BOT_MIN_TICK
        bot.countTick = Math.floor(this.rng() * range) + BOT_MIN_TICK
      }
      if (bot.canMove) {
        bot.animation = 'walk'
        bot.x += WALK_SPEED * GameRoomService.TICK_SCALE
        // Bots are allowed to cross the arrival line and walk off-screen —
        // it's purely cosmetic, nothing triggers on bot arrival.
      } else {
        bot.animation = 'idle'
      }
    }
  }

  private snapshotBots(): BotState[] {
    return this.bots.map(({ canMove: _c, countTick: _t, ...rest }) => rest)
  }

  private spawnPlayer(id: string, index: number): PlayerState {
    const x = this.spawnX()
    const y = this.spawnY()
    return {
      id,
      type: this.pickType(),
      x,
      y,
      animation: 'idle',
      isAlive: true,
      bulletsRemaining: BULLETS_PER_PLAYER,
      color: CROSSHAIR_PALETTE[index % CROSSHAIR_PALETTE.length]!,
      // Initial pointer position colocated with the player so before the
      // first input event there's still a valid crosshair to render.
      pointer: { x, y: y - 60 },
      username: this.usernames.get(id) ?? '',
    }
  }

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
}
