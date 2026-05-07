import { describe, expect, it } from 'vitest'

import { Layout } from '../Layout'

const WORLD = { worldWidth: 1920, worldHeight: 886 }
const RATIO = WORLD.worldWidth / WORLD.worldHeight

describe('Layout', () => {
  it('uses full window height when window is wider than the world ratio', () => {
    const layout = new Layout(WORLD)
    layout.recompute({ innerWidth: 3000, innerHeight: 1000 })
    expect(layout.canvasWidth).toBe(3000)
    expect(layout.canvasHeight).toBe(1000)
    expect(layout.playArea.height).toBe(1000)
    expect(layout.playArea.width).toBeCloseTo(1000 * RATIO, 5)
    expect(layout.playArea.y).toBe(0)
    expect(layout.playArea.x).toBeCloseTo((3000 - layout.playArea.width) / 2, 5)
  })

  it('uses full window width when window is narrower than the world ratio', () => {
    const layout = new Layout(WORLD)
    layout.recompute({ innerWidth: 1000, innerHeight: 1000 })
    expect(layout.playArea.width).toBe(1000)
    expect(layout.playArea.height).toBeCloseTo(1000 / RATIO, 5)
    expect(layout.playArea.x).toBe(0)
    expect(layout.playArea.y).toBeCloseTo((1000 - layout.playArea.height) / 2, 5)
  })

  it('exposes the arrival line as a fixed world coordinate', () => {
    const layout = new Layout({ ...WORLD, arrivalLineMargin: 30 })
    expect(layout.arrivalLineX).toBe(1920 - 30)
  })

  it('computes worldScale from playArea width vs worldWidth', () => {
    const layout = new Layout(WORLD)
    layout.recompute({ innerWidth: 960, innerHeight: 1000 })
    // window narrower than 19.5:9 → playArea.width = 960, worldScale = 960/1920 = 0.5
    expect(layout.worldScale).toBeCloseTo(0.5, 5)
  })

  it('worldScale is 1 when playArea width matches worldWidth', () => {
    const layout = new Layout(WORLD)
    // 1920×1080 → window ratio 1.78 < 2.166, fit by width: playArea.width = 1920
    layout.recompute({ innerWidth: 1920, innerHeight: 1080 })
    expect(layout.playArea.width).toBe(1920)
    expect(layout.worldScale).toBe(1)
  })

  it('zombieScale is 1 on desktop and capped at 2× on small screens', () => {
    const layout = new Layout(WORLD)
    layout.recompute({ innerWidth: 1920, innerHeight: 1080 })
    expect(layout.zombieScale).toBe(1)

    layout.recompute({ innerWidth: 960, innerHeight: 1000 }) // worldScale = 0.5
    expect(layout.zombieScale).toBe(2)

    layout.recompute({ innerWidth: 480, innerHeight: 1000 }) // worldScale = 0.25 → would be 4×
    expect(layout.zombieScale).toBe(2) // capped
  })

  it('honours a custom maxZombieScale', () => {
    const layout = new Layout({ ...WORLD, maxZombieScale: 1.5 })
    layout.recompute({ innerWidth: 480, innerHeight: 1000 })
    expect(layout.zombieScale).toBe(1.5)
  })
})
