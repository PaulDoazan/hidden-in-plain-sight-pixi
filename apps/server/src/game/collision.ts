import type { ZombieType } from '@hips/shared'

import { ZOMBIE_BODY_BOX } from './zombie-aabb'

export interface Point {
  x: number
  y: number
}

export interface ServerAABB {
  x: number
  y: number
  width: number
  height: number
}

export interface CollidableTarget {
  id: string
  x: number
  y: number
  type: ZombieType
  isAlive: boolean
}

export function isPointInAABB(point: Point, box: ServerAABB): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

export function aabbFor(target: CollidableTarget, scale = 1): ServerAABB {
  // Mirror Zombie.aabb on the client: anchor (0.5, 1.0), so the box hangs
  // upward from feet. `scale` matches the per-client `zombieScale` boost the
  // shooter applies to its rendered sprites — without it, the server's
  // hitbox is smaller than what the shooter saw and clicks on the visible
  // sprite are silently rejected.
  const box = ZOMBIE_BODY_BOX[target.type]
  const w = box.width * scale
  const h = box.height * scale
  return {
    x: target.x - w / 2,
    y: target.y - h,
    width: w,
    height: h,
  }
}

export function findNearestHit<T extends CollidableTarget>(
  point: Point,
  targets: readonly T[],
  scale = 1,
): T | null {
  const containing = targets.filter(
    (t) => t.isAlive && isPointInAABB(point, aabbFor(t, scale)),
  )
  if (containing.length === 0) return null
  // Prefer the zombie drawn in front (highest y), matching the client's
  // depth-sort tiebreak in CollisionDetector.
  containing.sort((a, b) => b.y - a.y)
  return containing[0] ?? null
}
