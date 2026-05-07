export interface Point {
  x: number
  y: number
}

export interface AABB {
  x: number
  y: number
  width: number
  height: number
}

export interface CollidableZombie {
  x: number
  y: number
  aabb: AABB
  isAlive: boolean
}

export function isPointInAABB(point: Point, box: AABB): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function findNearestZombieWithin<T extends CollidableZombie>(
  point: Point,
  zombies: readonly T[],
  radius: number,
): T | null {
  const alive = zombies.filter((z) => z.isAlive)
  const containing = alive.filter((z) => isPointInAABB(point, z.aabb))
  if (containing.length > 0) {
    containing.sort((a, b) => distance(point, a) - distance(point, b))
    return containing[0] ?? null
  }
  const within = alive.filter((z) => distance(point, z) <= radius)
  if (within.length === 0) return null
  within.sort((a, b) => distance(point, a) - distance(point, b))
  return within[0] ?? null
}
