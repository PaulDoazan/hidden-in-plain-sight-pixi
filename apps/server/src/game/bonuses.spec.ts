import type { BonusId } from '@hips/shared'

import { BONUS_REGISTRY, BOMB_BOT_KILL_RATIO, type BonusContext } from './bonuses'
import type { BotInternalState, PlayerInternalState } from './room-state'

function makePlayer(over: Partial<PlayerInternalState> = {}): PlayerInternalState {
  return {
    id: 'a',
    type: 'man',
    x: 100,
    y: 500,
    animation: 'idle',
    isAlive: true,
    bulletsRemaining: 1,
    color: 0xff5252,
    pointer: { x: 0, y: 0 },
    username: 'Antoine',
    bonus: null,
    bonusCharges: 0,
    runMultiplier: 1,
    ...over,
  }
}

function makeBots(count: number): BotInternalState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot-${i}`,
    type: 'woman' as const,
    x: 200 + i,
    y: 400 + i,
    animation: 'idle' as const,
    isAlive: true,
    canMove: false,
    countTick: 10,
  }))
}

function makeCtx(
  player: PlayerInternalState,
  bots: BotInternalState[],
  rng = () => 0,
): BonusContext {
  return {
    player,
    aliveBots: () => bots.filter((b) => b.isAlive),
    rng,
  }
}

describe('bonus registry — passive spawn effects', () => {
  it('magazine adds one bullet at spawn', () => {
    const player = makePlayer({ bulletsRemaining: 1 })
    BONUS_REGISTRY.magazine.onRoundStart!(makeCtx(player, []))
    expect(player.bulletsRemaining).toBe(2)
  })

  it('sprint raises the run multiplier', () => {
    const player = makePlayer()
    BONUS_REGISTRY.sprint.onRoundStart!(makeCtx(player, []))
    expect(player.runMultiplier).toBeGreaterThan(1)
  })
})

describe('bonus registry — bomb', () => {
  it('kills a fifth of the living bots, rounded up', () => {
    const bots = makeBots(20)
    const outcome = BONUS_REGISTRY.bomb.onActivate!(makeCtx(makePlayer(), bots))
    expect(outcome).toEqual({ reveal: true })
    const dead = bots.filter((b) => !b.isAlive)
    expect(dead).toHaveLength(Math.ceil(20 * BOMB_BOT_KILL_RATIO))
    for (const b of dead) expect(b.animation).toBe('die')
  })

  it('always kills at least one bot', () => {
    const bots = makeBots(2)
    BONUS_REGISTRY.bomb.onActivate!(makeCtx(makePlayer(), bots))
    expect(bots.filter((b) => !b.isAlive)).toHaveLength(1)
  })

  it('refuses to fire when no bot is alive, so the charge is kept', () => {
    expect(BONUS_REGISTRY.bomb.onActivate!(makeCtx(makePlayer(), []))).toBeNull()
  })
})

describe('bonus registry — skin swap', () => {
  it('swaps position and appearance with a living bot, both alive', () => {
    const player = makePlayer({ x: 100, y: 500, type: 'man' })
    const bots = makeBots(1)
    const botBefore = { x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }
    const outcome = BONUS_REGISTRY['skin-swap'].onActivate!(makeCtx(player, bots))
    expect(outcome).toEqual({ reveal: false })
    expect({ x: player.x, y: player.y, type: player.type }).toEqual(botBefore)
    expect({ x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }).toEqual({
      x: 100,
      y: 500,
      type: 'man',
    })
    expect(bots[0]!.isAlive).toBe(true)
  })

  it('refuses to fire when no bot is alive', () => {
    expect(BONUS_REGISTRY['skin-swap'].onActivate!(makeCtx(makePlayer(), []))).toBeNull()
  })
})

describe('bonus registry — lethal hit', () => {
  it('the vest absorbs the hit on the spot and is revealed', () => {
    const player = makePlayer({ x: 100, y: 500 })
    const outcome = BONUS_REGISTRY.vest.onLethalHit!(makeCtx(player, makeBots(3)))
    expect(outcome).toEqual({ survived: true, reveal: true })
    expect(player.x).toBe(100)
  })

  it("the extra life swaps with a bot that dies in the player's place", () => {
    const player = makePlayer({ x: 100, y: 500, type: 'man' })
    const bots = makeBots(3)
    const decoyBefore = { x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }
    const outcome = BONUS_REGISTRY['extra-life'].onLethalHit!(makeCtx(player, bots))
    expect(outcome.survived).toBe(true)
    expect(outcome.reveal).toBe(false)
    expect(outcome.diedInstead).toBe(bots[0])
    expect(bots[0]!.isAlive).toBe(false)
    expect(bots[0]!.animation).toBe('die')
    // The decoy died where the player stood; the player now stands where the
    // decoy was, wearing its appearance.
    expect({ x: bots[0]!.x, y: bots[0]!.y, type: bots[0]!.type }).toEqual({
      x: 100,
      y: 500,
      type: 'man',
    })
    expect({ x: player.x, y: player.y, type: player.type }).toEqual(decoyBefore)
  })

  it('the extra life cannot save a player when no bot is alive', () => {
    const outcome = BONUS_REGISTRY['extra-life'].onLethalHit!(makeCtx(makePlayer(), []))
    expect(outcome).toEqual({ survived: false, reveal: false })
  })
})

describe('bonus registry — shape', () => {
  it('declares a hook for every bonus and matches the shared kinds', () => {
    const ids = Object.keys(BONUS_REGISTRY) as BonusId[]
    for (const id of ids) {
      const def = BONUS_REGISTRY[id]
      const hasHook =
        Boolean(def.onRoundStart) || Boolean(def.onActivate) || Boolean(def.onLethalHit)
      expect(hasHook).toBe(true)
      if (def.kind === 'active') expect(def.onActivate).toBeDefined()
    }
  })
})
