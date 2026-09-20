import type { ZombieState } from '@hips/shared'

import { Zombie, type ZombieDeps } from './Zombie'

// Convergence rate of the exponential smoothing applied to remote entities.
// Higher = snappier (closer to raw teleport), lower = smoother but more lag.
// Tuned for a 30 Hz server tick: ~12 reaches ~95% of a new target in 250 ms.
const SMOOTHING_PER_SECOND = 12

// Above this distance (world units) between two consecutive snapshots, a
// snapshot is treated as a teleport rather than movement, and applied instantly
// instead of lerped. The two body-swap bonuses (skin-swap, extra-life) relocate
// a zombie by hundreds of units in a single snapshot; ordinary movement never
// comes remotely close — even a sprint-boosted run tops out around
// RUN_SPEED(2.2 px/frame@60fps) * 1.35 * 2 (ticks-per-render-frame at 30 Hz)
// ≈ 6 world units per snapshot. 50 sits well above the movement ceiling and
// well below any swap distance. Without this, ~1/3 of swaps (the decoy bot
// happens to share the player's type, so `reconcileZombie` doesn't rebuild it)
// would lerp over ~250 ms, visibly gliding two zombies past each other —
// exactly the tell the swap bonuses exist to avoid.
const TELEPORT_DISTANCE_SQUARED = 50 * 50

export class PlayerZombie extends Zombie {
  // PlayerZombie no longer reads input directly; it is a pure renderer
  // driven by server state. The Zombie base class handles animation switching
  // and aabb computation; this class is only responsible for applying snapshots.
  private targetX = 0
  private targetY = 0
  private interpolated = true
  private hasSnapshot = false

  constructor(deps: ZombieDeps) {
    super(deps)
  }

  // Local player must NOT be interpolated: it would introduce visible lag on
  // the player's own movements. Bots and other players are interpolated to
  // smooth out the 30 Hz server tick on a 60 Hz render loop.
  setInterpolated(on: boolean): void {
    this.interpolated = on
  }

  applyServerState(state: ZombieState): void {
    const dx = state.x - this.x
    const dy = state.y - this.y
    const teleported = dx * dx + dy * dy > TELEPORT_DISTANCE_SQUARED
    this.targetX = state.x
    this.targetY = state.y
    // Snap on the very first snapshot (otherwise the sprite would lerp in
    // from its constructor position), whenever interpolation is disabled, or
    // whenever the server moved this zombie by a teleport-sized jump (a body
    // swap) — see TELEPORT_DISTANCE_SQUARED.
    if (!this.interpolated || !this.hasSnapshot || teleported) {
      this.x = state.x
      this.y = state.y
    }
    this.hasSnapshot = true
    if (state.isAlive !== this.isAlive) {
      if (!state.isAlive) this.die()
    }
    this.playAnimation(state.animation)
  }

  override update(delta: number): void {
    if (!this.interpolated) return
    // Pixi's `delta` is in frame units (1 ≈ 16.66 ms at 60 fps). Convert to
    // seconds so the smoothing rate stays frame-rate independent.
    const dtSec = delta / 60
    const alpha = 1 - Math.exp(-SMOOTHING_PER_SECOND * dtSec)
    this.x += (this.targetX - this.x) * alpha
    this.y += (this.targetY - this.y) * alpha
  }
}
