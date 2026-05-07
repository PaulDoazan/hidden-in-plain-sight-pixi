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
    const next = tickBotState(state, cycle, seq([15]))
    expect(next.countTick).toBe(4)
  })

  it('flips canMove and resets countTick when countTick hits zero', () => {
    const state: BotState = { canMove: false, countTick: 1, x: 100 }
    const next = tickBotState(state, cycle, seq([12]))
    expect(next.canMove).toBe(true)
    expect(next.countTick).toBe(12)
  })

  it('advances x by walkSpeed when canMove is true', () => {
    const state: BotState = { canMove: true, countTick: 5, x: 100 }
    const next = tickBotState(state, cycle, seq([15]))
    expect(next.x).toBeCloseTo(100.5, 5)
  })

  it('does not advance x when canMove is false', () => {
    const state: BotState = { canMove: false, countTick: 5, x: 100 }
    const next = tickBotState(state, cycle, seq([15]))
    expect(next.x).toBe(100)
  })
})
