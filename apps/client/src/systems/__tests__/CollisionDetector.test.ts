import { describe, expect, it } from 'vitest'

import { findNearestZombieWithin, isPointInAABB } from '../CollisionDetector'

const aabb = (x: number, y: number, w = 40, h = 80) => ({ x, y, width: w, height: h })

interface FakeZombie {
  id: string
  x: number
  y: number
  aabb: { x: number; y: number; width: number; height: number }
  isAlive: boolean
}

const makeZombie = (id: string, x: number, y: number, isAlive = true): FakeZombie => ({
  id,
  x,
  y,
  aabb: { x: x - 20, y: y - 80, width: 40, height: 80 },
  isAlive,
})

describe('isPointInAABB', () => {
  it('returns true when point is inside', () => {
    expect(isPointInAABB({ x: 50, y: 50 }, aabb(20, 20, 60, 60))).toBe(true)
  })
  it('returns false when point is outside', () => {
    expect(isPointInAABB({ x: 0, y: 0 }, aabb(20, 20, 60, 60))).toBe(false)
  })
  it('treats edges as inside', () => {
    expect(isPointInAABB({ x: 20, y: 20 }, aabb(20, 20, 60, 60))).toBe(true)
  })
})

describe('findNearestZombieWithin', () => {
  it('returns null when no zombie is within radius', () => {
    const zombies = [makeZombie('a', 500, 500)]
    expect(findNearestZombieWithin({ x: 0, y: 0 }, zombies, 50)).toBeNull()
  })

  it('returns the closest zombie whose AABB contains the point', () => {
    const z1 = makeZombie('a', 100, 100)
    const z2 = makeZombie('b', 105, 100)
    const result = findNearestZombieWithin({ x: 100, y: 50 }, [z1, z2], 200)
    expect(result?.id).toBe('a')
  })

  it('skips dead zombies', () => {
    const z1 = makeZombie('a', 100, 100, false)
    const z2 = makeZombie('b', 130, 100, true)
    const result = findNearestZombieWithin({ x: 100, y: 50 }, [z1, z2], 200)
    expect(result?.id).toBe('b')
  })

  it('falls back to nearest within radius if none contains the point', () => {
    const z1 = makeZombie('a', 200, 200)
    const z2 = makeZombie('b', 300, 300)
    const result = findNearestZombieWithin({ x: 210, y: 210 }, [z1, z2], 100)
    expect(result?.id).toBe('a')
  })
})
