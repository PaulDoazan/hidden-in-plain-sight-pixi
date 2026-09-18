import type {
  BonusId,
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
  BONUS_IDS,
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

import {
  BONUS_REGISTRY,
  HORDE_MAX_RADIUS,
  HORDE_MIN_RADIUS,
  type BonusContext,
  type LethalHitOutcome,
} from './bonuses'
import { BonusDraft } from './bonus-draft'
import type { BotInternalState, PlayerInternalState } from './room-state'
import { findNearestHit } from './collision'

const TYPES: ZombieType[] = ['man', 'woman', 'wild']
export const BULLETS_PER_PLAYER = 1

// Bullets handed back to the shooter for killing a real player. Bot kills earn
// nothing, so spending your shot on the camouflage still costs you the round.
// With BULLETS_PER_PLAYER at 1 the reward exactly refunds the shot, which is
// the point: land your shot on a player and you stay armed.
export const BULLET_REWARD_PER_PLAYER_KILL = 1

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

// Vertical placement band. Zombies are spread evenly across it with stratified
// sampling (see spawnY) rather than pure random, so they don't clump with big
// gaps. Anonymity is preserved because the player/bot lineup is shuffled before
// y is assigned, so a real player's row is still indistinguishable from a bot's.
// Top limit is two fifths of the world height, matching the dashed arrival
// line. Bottom limit reaches 80 units past the world's bottom edge to stretch
// the spread lower into the background shown below the world on wide (e.g.
// 16:9) screens. Trade-off: on phones whose ratio matches the world (iPhone
// landscape) the lowest zombies are clipped at the bottom — accepted on
// purpose. The top limit is unchanged so the highest zombie sits as before.
export const SPAWN_Y_MIN = WORLD_HEIGHT * (2 / 5)
export const SPAWN_Y_MAX = WORLD_HEIGHT + 80
// Within each zombie's equal vertical sub-band, y lands in this central
// fraction (0.2…0.8). Keeps the spread regular while avoiding a rigid grid.
const SPAWN_Y_JITTER = 0.6

// What `start()` hands back: either a draft to run first, or a round that has
// already begun because the host turned bonuses off.
export type StartOutcome =
  | { kind: 'draft'; offers: { playerId: string; offer: BonusId[] }[] }
  | { kind: 'started'; started: GameStartedPayload }

// Per-room state. Owned and instantiated by RoomRegistry; not a Nest provider.
export class GameRoomService {
  private readonly playerOrder: string[] = []
  // Authoritative username per socket. Set at addPlayer time, persists across
  // start/replay cycles. Cleared on removePlayer.
  private readonly usernames = new Map<string, string>()
  private readonly players = new Map<string, PlayerInternalState>()
  private readonly inputs = new Map<string, InputPayload>()
  private bots: BotInternalState[] = []
  // Open draft, or null outside the `drafting` status.
  private draft: BonusDraft | null = null
  // Per-room cumulative scores. Survives replay() so a series of games in
  // the same room feels like a tournament; cleared when the room empties.
  private readonly scores = new Map<string, { total: number; lastDelta: number }>()
  private status: RoomStatus = 'waiting'
  // Host-controlled: the bonuses a round may draw from. Starts as the whole
  // catalogue; an empty set means the round skips the draft entirely and
  // everyone runs bonus-less. Deliberately NOT reset by replay(), so a lobby
  // keeps its ruleset for a whole series.
  private readonly enabledBonuses = new Set<BonusId>(BONUS_IDS)
  // Ever-increasing, so a Horde's bots can never reuse a live bot's id.
  private nextBotIndex = 0
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
    this.draft?.forget(id)
    // Empty room: drop any leftover game state so the next connection starts
    // in a clean `waiting` lobby. Without this, refreshing the host while
    // running/ended leaves the room stuck and the next Démarrer click is
    // silently rejected by `start()` (status guard).
    if (this.playerOrder.length === 0 && this.status !== 'waiting') {
      this.status = 'waiting'
      this.draft = null
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
      // Catalogue order, not insertion order: the lobby list must not reshuffle
      // under the host every time a box is ticked.
      enabledBonuses: BONUS_IDS.filter((id) => this.enabledBonuses.has(id)),
    }
  }

  // Only the host, and only while the lobby is open: changing the pool
  // mid-draft would leave offers on screen drawn from a stale selection.
  setBonusEnabled(requesterId: string, bonusId: BonusId, enabled: boolean): boolean {
    if (this.status !== 'waiting') return false
    if (this.playerOrder[0] !== requesterId) return false
    if (enabled) this.enabledBonuses.add(bonusId)
    else this.enabledBonuses.delete(bonusId)
    return true
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

  // Opens the draft. Spawning waits for resolveDraft(): two passive bonuses
  // change a player's starting state, and applying them to a freshly spawned
  // player is simpler than spawning first and patching afterwards.
  start(requesterId: string): StartOutcome | null {
    if (this.status !== 'waiting') return null
    if (this.playerOrder.length === 0) return null
    if (this.playerOrder[0] !== requesterId) return null

    // Nothing enabled: no draft phase at all. The round begins on the spot
    // with everyone bonus-less, which is this game's pre-draft behaviour.
    const pool = BONUS_IDS.filter((id) => this.enabledBonuses.has(id))
    if (pool.length === 0) {
      this.beginRound([...this.playerOrder])
      return { kind: 'started', started: this.startedPayload() }
    }

    this.draft = new BonusDraft([...this.playerOrder], this.rng, pool)
    this.status = 'drafting'
    return { kind: 'draft', offers: this.draft.entries() }
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
  // every drafted bonus, and hands the gateway the usual game-started payload
  // plus the resolved picks — the gateway needs the latter to tell each owner
  // what it was granted (see `bonus-granted`), since a socket that joined
  // mid-draft is not in `picks` and must not be spawned into the round.
  resolveDraft(): { started: GameStartedPayload; picks: Map<string, BonusId> } | null {
    if (this.status !== 'drafting' || !this.draft) return null
    const picks = this.draft.resolve()
    this.draft = null

    // Spawn only players the draft actually resolved for — not the full
    // `playerOrder`, which may since have grown with a socket that joined
    // mid-draft and was never offered a card.
    this.beginRound(this.playerOrder.filter((id) => picks.has(id)))

    for (const player of this.players.values()) {
      const bonusId = picks.get(player.id)
      if (bonusId) this.assignBonus(player, bonusId)
    }

    return { started: this.startedPayload(), picks }
  }

  // Wipes the previous round and puts the given players on the field. Shared
  // by both ways into a round: a resolved draft, and a draft-less start.
  private beginRound(playerIds: string[]): void {
    this.players.clear()
    this.bots = []
    this.nextBotIndex = 0
    this.spawnLineup(playerIds)
    this.status = 'running'
  }

  private startedPayload(): GameStartedPayload {
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
      spawnBotsAround: (count, x, y) => this.spawnBotsAround(count, x, y),
    }
  }

  // Drops `count` fresh bots in a ring around (x, y): far enough not to stack
  // on the caster, close enough to read as the crowd they are hiding in. The
  // y spread is clamped to the playfield band so none lands off the ground.
  private spawnBotsAround(count: number, x: number, y: number): void {
    for (let i = 0; i < count; i++) {
      const angle = this.rng() * Math.PI * 2
      const radius =
        HORDE_MIN_RADIUS + this.rng() * (HORDE_MAX_RADIUS - HORDE_MIN_RADIUS)
      const bot = this.spawnBot(this.nextBotIndex++, y + Math.sin(angle) * radius)
      bot.x = Math.min(WORLD_WIDTH, Math.max(0, x + Math.cos(angle) * radius))
      bot.y = Math.min(SPAWN_Y_MAX, Math.max(SPAWN_Y_MIN, bot.y))
      this.bots.push(bot)
    }
  }

  // Test-only: grants a bonus as if it had been drafted, so effect tests do
  // not have to steer the random draw. Resets the round-start-derived fields
  // to their spawn defaults first: assignBonus only *applies* a bonus's
  // onRoundStart effect, it never undoes a previous one, so calling this
  // after the room already auto-drafted (say) sprint for the player would
  // otherwise leave runMultiplier at 1.35 even after forcing a different
  // bonus.
  forceBonusForTest(playerId: string, bonusId: BonusId): void {
    const player = this.players.get(playerId)
    if (!player) return
    player.bulletsRemaining = BULLETS_PER_PLAYER
    player.runMultiplier = 1
    this.assignBonus(player, bonusId)
  }

  // Triggers the player's active bonus. Dead players may use it, exactly as
  // they may still fire — the revenge rule stays uniform.
  useBonus(
    playerId: string,
  ): { bonusId: BonusId; reveal: boolean; killedIds?: string[] } | null {
    if (this.status !== 'running') return null
    const player = this.players.get(playerId)
    if (!player?.bonus || player.bonusCharges <= 0) return null
    const def = BONUS_REGISTRY[player.bonus]
    if (!def.onActivate) return null
    const outcome = def.onActivate(this.bonusContext(player))
    // A refused activation (nothing to act on) keeps the charge.
    if (!outcome) return null
    player.bonusCharges -= 1
    return {
      bonusId: player.bonus,
      reveal: outcome.reveal,
      ...(outcome.killedIds ? { killedIds: outcome.killedIds } : {}),
    }
  }

  // Builds this round's lineup. Called only from resolveDraft(), once the
  // players map and bots array have been cleared. `playerIds` is the set the
  // draft actually resolved for — not necessarily all of `playerOrder` (see
  // resolveDraft's comment on mid-draft joiners).
  private spawnLineup(playerIds: string[]): void {
    // Build a single shuffled lineup of all entities — every real player
    // (host included) and every bot — so a real player's spawn position is
    // indistinguishable from a bot's.
    type Slot =
      | { kind: 'player'; id: string; index: number }
      | { kind: 'bot'; index: number }
    const slots: Slot[] = []
    playerIds.forEach((id, i) => {
      slots.push({ kind: 'player', id, index: i })
    })
    for (let i = 0; i < BOT_COUNT; i++) {
      slots.push({ kind: 'bot', index: i })
    }
    this.shuffle(slots)

    // y is stratified over the shuffled lineup: each slot gets its own equal
    // vertical sub-band, so the spread is even across players and bots alike.
    const total = slots.length
    slots.forEach((slot, k) => {
      const y = this.spawnY(k, total)
      if (slot.kind === 'player') {
        this.players.set(slot.id, this.spawnPlayer(slot.id, slot.index, y))
      } else {
        this.bots.push(this.spawnBot(slot.index, y))
      }
    })
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
        player.x += RUN_SPEED * GameRoomService.TICK_SCALE * player.runMultiplier
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

  // Drops the server-private fields (bonus, charges, speed) so a snapshot
  // never leaks a player's drafted bonus to the rest of the room.
  private snapshotPlayers(): PlayerState[] {
    return [...this.players.values()].map(
      ({ bonus: _b, bonusCharges: _c, runMultiplier: _m, ...rest }) => rest,
    )
  }

  snapshotState(): StatePayload {
    return { players: this.snapshotPlayers(), bots: this.snapshotBots() }
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
    // Set when a bonus swallowed the hit: the target lives, and the gateway
    // announces the bonus instead of a kill. `reveal` comes straight from the
    // hook's own outcome — the gateway must not assume "absorbed ⇒ reveal"
    // (true today only because the vest is the sole absorbing bonus and it
    // happens to always reveal; a future silent absorb would break that
    // assumption).
    absorbedBy?: { playerId: string; bonusId: BonusId; reveal: boolean }
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
        absorbedBy: { playerId: hit.id, bonusId: target!.bonus!, reveal: outcome.reveal },
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
  }

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

  replay(requesterId: string): boolean {
    if (this.status !== 'ended') return false
    if (this.playerOrder[0] !== requesterId) return false
    this.status = 'waiting'
    this.players.clear()
    this.draft = null
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

  private spawnBot(i: number, y: number): BotInternalState {
    this.nextBotIndex = Math.max(this.nextBotIndex, i + 1)
    const cycleRange = BOT_MAX_TICK - BOT_MIN_TICK
    return {
      id: `bot-${i}`,
      type: this.pickType(),
      x: this.spawnX(),
      y,
      animation: 'idle',
      isAlive: true,
      canMove: false,
      countTick: Math.floor(this.rng() * cycleRange) + BOT_MIN_TICK,
      forcedRun: false,
    }
  }

  private pickType(): ZombieType {
    return TYPES[Math.floor(this.rng() * TYPES.length)]!
  }

  private spawnX(): number {
    return SPAWN_BAND_X + this.rng() * SPAWN_BAND_WIDTH
  }

  // Stratified y: the band is split into `total` equal sub-bands and the
  // `index`-th zombie lands in its own sub-band, within the central
  // SPAWN_Y_JITTER fraction. Even coverage, no clumps or big gaps, but not a
  // rigid line. `index` walks the already-shuffled lineup, so it leaks no
  // player/bot info.
  private spawnY(index: number, total: number): number {
    const step = (SPAWN_Y_MAX - SPAWN_Y_MIN) / total
    const offset = (1 - SPAWN_Y_JITTER) / 2 + this.rng() * SPAWN_Y_JITTER
    return SPAWN_Y_MIN + (index + offset) * step
  }

  private tickBots(): void {
    for (const bot of this.bots) {
      if (!bot.isAlive) {
        bot.animation = 'die'
        continue
      }
      // A runaway never returns to the walk/idle cycle: it runs until the
      // round ends, crossing the arrival line and leaving the field like any
      // other bot is allowed to.
      if (bot.forcedRun) {
        bot.animation = 'run'
        bot.x += RUN_SPEED * GameRoomService.TICK_SCALE
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

  private spawnPlayer(id: string, index: number, y: number): PlayerInternalState {
    const x = this.spawnX()
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
      bonus: null,
      bonusCharges: 0,
      runMultiplier: 1,
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
