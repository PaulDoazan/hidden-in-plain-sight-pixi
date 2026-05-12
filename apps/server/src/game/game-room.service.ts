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
import {
  ARRIVAL_LINE_X,
  BOT_COUNT,
  RUN_SPEED,
  SERVER_TICK_HZ,
  SPAWN_BAND_WIDTH,
  SPAWN_BAND_X,
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

// Vertical placement: the host gets the topmost spawn y; every other zombie
// (players + bots) spawns below it. Top limit is two fifths of the world
// height, so the whole lineup fits in the bottom three fifths of the screen.
const HOST_SPAWN_Y = WORLD_HEIGHT * (2 / 5)
const OTHERS_SPAWN_Y_MIN = HOST_SPAWN_Y + 30
const OTHERS_SPAWN_Y_MAX = WORLD_HEIGHT * 0.9

interface BotInternalState extends BotState {
  canMove: boolean
  countTick: number
}

// Per-room state. Owned and instantiated by RoomRegistry; not a Nest provider.
export class GameRoomService {
  private readonly playerOrder: string[] = []
  private readonly players = new Map<string, PlayerState>()
  private readonly inputs = new Map<string, InputPayload>()
  private bots: BotInternalState[] = []
  private status: RoomStatus = 'waiting'
  private static readonly TICK_SCALE = 60 / SERVER_TICK_HZ

  // Test hook: injected RNG so spawn/tick are deterministic in unit tests.
  // Defaults to Math.random in production.
  private rng: () => number = Math.random

  setRngForTest(rng: () => number): void {
    this.rng = rng
  }

  addPlayer(id: string): void {
    if (this.playerOrder.includes(id)) return
    this.playerOrder.push(id)
  }

  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
    this.players.delete(id)
    this.inputs.delete(id)
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
      players: this.playerOrder.map((id, i) => ({ id, isHost: i === 0 })),
      status: this.status,
    }
  }

  start(requesterId: string): GameStartedPayload | null {
    if (this.status !== 'waiting') return null
    if (this.playerOrder.length === 0) return null
    if (this.playerOrder[0] !== requesterId) return null

    this.players.clear()
    this.playerOrder.forEach((id, i) => {
      this.players.set(id, this.spawnPlayer(id, i))
    })
    this.spawnBots()
    this.status = 'running'
    return {
      players: [...this.players.values()],
      bots: this.snapshotBots(),
      arrivalLineX: ARRIVAL_LINE_X,
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

  // Convenience method: tick + arrival-line check, used by the gateway loop.
  tickAndCheckWinner(): { winnerId: string } | null {
    if (this.status !== 'running') return null
    this.tick()
    for (const p of this.players.values()) {
      if (p.isAlive && p.x >= ARRIVAL_LINE_X) {
        this.status = 'ended'
        return { winnerId: p.id }
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
    return true
  }

  // Test-only helper for asserting bot-related behavior without seeding RNG.
  botsForTest(): readonly BotState[] {
    return this.bots
  }

  private spawnBots(): void {
    this.bots = []
    for (let i = 0; i < BOT_COUNT; i++) {
      const cycleRange = BOT_MAX_TICK - BOT_MIN_TICK
      this.bots.push({
        id: `bot-${i}`,
        type: TYPES[i % TYPES.length]!,
        x: this.spawnX(),
        y: this.spawnOtherY(),
        animation: 'idle',
        isAlive: true,
        canMove: false,
        countTick: Math.floor(this.rng() * cycleRange) + BOT_MIN_TICK,
      })
    }
  }

  private spawnX(): number {
    return SPAWN_BAND_X + this.rng() * SPAWN_BAND_WIDTH
  }

  private spawnOtherY(): number {
    return OTHERS_SPAWN_Y_MIN + this.rng() * (OTHERS_SPAWN_Y_MAX - OTHERS_SPAWN_Y_MIN)
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
    // The host (index 0) anchors the top of the lineup; every other player
    // spawns somewhere in the band below them.
    const y = index === 0 ? HOST_SPAWN_Y : this.spawnOtherY()
    return {
      id,
      type: TYPES[index % TYPES.length]!,
      x,
      y,
      animation: 'idle',
      isAlive: true,
      bulletsRemaining: BULLETS_PER_PLAYER,
      color: CROSSHAIR_PALETTE[index % CROSSHAIR_PALETTE.length]!,
      // Initial pointer position colocated with the player so before the
      // first input event there's still a valid crosshair to render.
      pointer: { x, y: y - 60 },
    }
  }
}
