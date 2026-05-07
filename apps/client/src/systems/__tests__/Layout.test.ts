import { describe, expect, it } from 'vitest'

import { Layout } from '../Layout'

describe('Layout', () => {
  it('uses full window height when window is wider than play ratio', () => {
    const layout = new Layout({ playAreaRatio: 19.5 / 9 })
    layout.recompute({ innerWidth: 3000, innerHeight: 1000 })
    expect(layout.canvasWidth).toBe(3000)
    expect(layout.canvasHeight).toBe(1000)
    expect(layout.playArea.height).toBe(1000)
    expect(layout.playArea.width).toBeCloseTo(1000 * (19.5 / 9), 5)
    expect(layout.playArea.y).toBe(0)
    expect(layout.playArea.x).toBeCloseTo((3000 - layout.playArea.width) / 2, 5)
  })

  it('uses full window width when window is narrower than play ratio', () => {
    const layout = new Layout({ playAreaRatio: 19.5 / 9 })
    layout.recompute({ innerWidth: 1000, innerHeight: 1000 })
    expect(layout.playArea.width).toBe(1000)
    expect(layout.playArea.height).toBeCloseTo(1000 / (19.5 / 9), 5)
    expect(layout.playArea.x).toBe(0)
    expect(layout.playArea.y).toBeCloseTo((1000 - layout.playArea.height) / 2, 5)
  })

  it('places the arrival line near the right edge of the play area', () => {
    const layout = new Layout({ playAreaRatio: 19.5 / 9, arrivalLineMargin: 30 })
    layout.recompute({ innerWidth: 2000, innerHeight: 800 })
    expect(layout.arrivalLineX).toBeCloseTo(
      layout.playArea.x + layout.playArea.width - 30,
      5,
    )
  })
})
