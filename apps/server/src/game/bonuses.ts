import type { BonusId, BonusKind } from '@hips/shared'
import { BONUS_INFO } from '@hips/shared'

import type { BotInternalState, PlayerInternalState } from './room-state'

// Share of the living bots a bomb takes out, rounded up, never fewer than one.
export const BOMB_BOT_KILL_RATIO = 0.2
// Sprint only touches running; walking is unchanged.
export const SPRINT_RUN_MULTIPLIER = 1.35
export const MAGAZINE_EXTRA_BULLETS = 1
// Bots the Horde conjures around its caster, and the ring they land in:
// far enough not to stack on top of the caster, close enough to read as
// the crowd they are hiding in.
export const HORDE_BOT_COUNT = 10
export const HORDE_MIN_RADIUS = 60
export const HORDE_MAX_RADIUS = 180

// What a hook is allowed to see and touch. Everything it needs is passed in,
// so bonuses stay pure functions of the room state and take the room's
// injected RNG — which keeps them deterministic under test.
export interface BonusContext {
  player: PlayerInternalState
  aliveBots: () => BotInternalState[]
  rng: () => number
  // Adds fresh bots scattered around a point. The room owns id allocation and
  // the bot factory, so it provides this rather than letting a hook build one.
  spawnBotsAround: (count: number, x: number, y: number) => void
}

export interface ActivateOutcome {
  // Whether the whole room is told. See the reveal rule in the design doc:
  // a bonus is announced only when somebody would otherwise be confused.
  reveal: boolean
  // Bots the activation killed, for the client to burst an explosion on.
  killedIds?: string[]
}

export interface LethalHitOutcome {
  survived: boolean
  reveal: boolean
  // Set when the player escaped by swapping with a bot that died in their
  // place. The caller reports that bot as the victim, so the rest of the
  // pipeline sees an ordinary bot kill — which is the illusion the bonus
  // is built on.
  diedInstead?: BotInternalState
}

export interface BonusDefinition {
  id: BonusId
  kind: BonusKind
  // Spawn time, once the player exists.
  onRoundStart?: (ctx: BonusContext) => void
  // The player pressed the trigger. Returning null refuses the activation and
  // keeps the charge (nothing to act on).
  onActivate?: (ctx: BonusContext) => ActivateOutcome | null
  // The player just took a lethal hit, before anything kills them.
  onLethalHit?: (ctx: BonusContext) => LethalHitOutcome
}

// Swaps position and appearance between a player and a bot. Both body-swap
// bonuses are built on it; only what happens to the bot afterwards differs.
function swapBodies(player: PlayerInternalState, bot: BotInternalState): void {
  const { x, y, type } = player
  player.x = bot.x
  player.y = bot.y
  player.type = bot.type
  bot.x = x
  bot.y = y
  bot.type = type
}

function pickRandom<T>(items: T[], rng: () => number): T | null {
  if (items.length === 0) return null
  return items[Math.floor(rng() * items.length)]!
}

export const BONUS_REGISTRY: Record<BonusId, BonusDefinition> = {
  bomb: {
    id: 'bomb',
    kind: BONUS_INFO.bomb.kind,
    onActivate: (ctx) => {
      const bots = ctx.aliveBots()
      if (bots.length === 0) return null
      const count = Math.min(bots.length, Math.max(1, Math.ceil(bots.length * BOMB_BOT_KILL_RATIO)))
      // Partial Fisher-Yates over a copy: an unbiased sample without
      // replacement, so no bot can be picked twice.
      const pool = [...bots]
      for (let i = 0; i < count; i++) {
        const j = i + Math.floor(ctx.rng() * (pool.length - i))
        const tmp = pool[i]!
        pool[i] = pool[j]!
        pool[j] = tmp
        pool[i]!.isAlive = false
        pool[i]!.animation = 'die'
      }
      return { reveal: true, killedIds: pool.slice(0, count).map((b) => b.id) }
    },
  },
  'extra-life': {
    id: 'extra-life',
    kind: BONUS_INFO['extra-life'].kind,
    onLethalHit: (ctx) => {
      const decoy = pickRandom(ctx.aliveBots(), ctx.rng)
      // No camouflage left to hide in: the player dies like anyone else.
      if (!decoy) return { survived: false, reveal: false }
      swapBodies(ctx.player, decoy)
      decoy.isAlive = false
      decoy.animation = 'die'
      return { survived: true, reveal: false, diedInstead: decoy }
    },
  },
  vest: {
    id: 'vest',
    kind: BONUS_INFO.vest.kind,
    onLethalHit: () => ({ survived: true, reveal: true }),
  },
  'skin-swap': {
    id: 'skin-swap',
    kind: BONUS_INFO['skin-swap'].kind,
    onActivate: (ctx) => {
      const target = pickRandom(ctx.aliveBots(), ctx.rng)
      if (!target) return null
      swapBodies(ctx.player, target)
      return { reveal: false }
    },
  },
  magazine: {
    id: 'magazine',
    kind: BONUS_INFO.magazine.kind,
    onRoundStart: (ctx) => {
      ctx.player.bulletsRemaining += MAGAZINE_EXTRA_BULLETS
    },
  },
  sprint: {
    id: 'sprint',
    kind: BONUS_INFO.sprint.kind,
    onRoundStart: (ctx) => {
      ctx.player.runMultiplier = SPRINT_RUN_MULTIPLIER
    },
  },
  runaway: {
    id: 'runaway',
    kind: BONUS_INFO.runaway.kind,
    onActivate: (ctx) => {
      const decoy = pickRandom(ctx.aliveBots(), ctx.rng)
      if (!decoy) return null
      decoy.forcedRun = true
      // Silent on purpose: a decoy that announces itself draws nothing.
      return { reveal: false }
    },
  },
  horde: {
    id: 'horde',
    kind: BONUS_INFO.horde.kind,
    onActivate: (ctx) => {
      // Never refuses: unlike the others it does not need a living bot, it
      // makes its own.
      ctx.spawnBotsAround(HORDE_BOT_COUNT, ctx.player.x, ctx.player.y)
      return { reveal: false }
    },
  },
}
