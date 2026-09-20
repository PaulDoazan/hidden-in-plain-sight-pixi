import { findNearestHit, isPointInAABB, type ServerAABB } from './collision'

describe('isPointInAABB', () => {
  const box: ServerAABB = { x: 100, y: 200, width: 40, height: 60 }

  it('returns true when the point is strictly inside', () => {
    expect(isPointInAABB({ x: 110, y: 220 }, box)).toBe(true)
  })

  it('returns true on the boundary', () => {
    expect(isPointInAABB({ x: 100, y: 200 }, box)).toBe(true)
    expect(isPointInAABB({ x: 140, y: 260 }, box)).toBe(true)
  })

  it('returns false when outside', () => {
    expect(isPointInAABB({ x: 99, y: 220 }, box)).toBe(false)
    expect(isPointInAABB({ x: 110, y: 261 }, box)).toBe(false)
  })
})

describe('findNearestHit', () => {
  it('returns null when no zombie contains the point', () => {
    const z = [{ id: 'a', x: 0, y: 0, type: 'man' as const, isAlive: true }]
    expect(findNearestHit({ x: 1000, y: 1000 }, z)).toBeNull()
  })

  it('returns the only zombie whose AABB contains the point', () => {
    const z = [{ id: 'a', x: 100, y: 500, type: 'man' as const, isAlive: true }]
    // 'man' box is 40 wide × 65 tall, anchor (0.5, 1.0) → x∈[80,120], y∈[435,500]
    expect(findNearestHit({ x: 100, y: 480 }, z)?.id).toBe('a')
  })

  it('picks the zombie with highest y (drawn last) when several overlap', () => {
    const z = [
      { id: 'back', x: 100, y: 480, type: 'man' as const, isAlive: true },
      { id: 'front', x: 100, y: 500, type: 'man' as const, isAlive: true },
    ]
    expect(findNearestHit({ x: 100, y: 460 }, z)?.id).toBe('front')
  })

  it('ignores dead zombies', () => {
    const z = [{ id: 'dead', x: 100, y: 500, type: 'man' as const, isAlive: false }]
    expect(findNearestHit({ x: 100, y: 480 }, z)).toBeNull()
  })
})
