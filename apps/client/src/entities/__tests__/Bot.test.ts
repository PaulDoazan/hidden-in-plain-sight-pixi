import { describe, expect, it } from 'vitest'

import { tickBotState, type BotState } from '../Bot'

const cycle = { minTick: 10, maxTick: 20, walkSpeed: 0.5 }
const seq = (values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('tickBotState', () => {
  it('decrements countTick each call', () => {
    const state: BotState = { canMove: false, countTick: 5, x: 100 }
    const next = tickBotState(state, cycle, seq([0.5]))
    expect(next.countTick).toBe(4)
  })

  it('flips canMove and resets countTick when countTick hits zero', () => {
    const state: BotState = { canMove: false, countTick: 1, x: 100 }
    // rng() = 0.2, range = 10, minTick = 10 -> countTick = floor(0.2*10) + 10 = 12
    const next = tickBotState(state, cycle, seq([0.2]))
    expect(next.canMove).toBe(true)
    expect(next.countTick).toBe(12)
  })

  it('uses Math.random-style [0,1) rng to land in [minTick, maxTick)', () => {
    // rng() = 0 -> countTick = floor(0*10) + 10 = 10 (== minTick)
    let next = tickBotState({ canMove: false, countTick: 1, x: 0 }, cycle, seq([0]))
    expect(next.countTick).toBe(10)
    // rng() = 0.999 -> countTick = floor(9.99) + 10 = 19 (< maxTick)
    next = tickBotState({ canMove: false, countTick: 1, x: 0 }, cycle, seq([0.999]))
    expect(next.countTick).toBe(19)
  })

  it('advances x by walkSpeed when canMove is true', () => {
    const state: BotState = { canMove: true, countTick: 5, x: 100 }
    const next = tickBotState(state, cycle, seq([0.5]))
    expect(next.x).toBeCloseTo(100.5, 5)
  })

  it('does not advance x when canMove is false', () => {
    const state: BotState = { canMove: false, countTick: 5, x: 100 }
    const next = tickBotState(state, cycle, seq([0.5]))
    expect(next.x).toBe(100)
  })
})
