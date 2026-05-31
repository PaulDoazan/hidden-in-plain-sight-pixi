import type { ZombieState } from '@hips/shared'

import { Zombie, type ZombieDeps } from './Zombie'

// Convergence rate of the exponential smoothing applied to remote entities.
// Higher = snappier (closer to raw teleport), lower = smoother but more lag.
// Tuned for a 30 Hz server tick: ~12 reaches ~95% of a new target in 250 ms.
const SMOOTHING_PER_SECOND = 12

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
    this.targetX = state.x
    this.targetY = state.y
    // Snap on the very first snapshot (otherwise the sprite would lerp in
    // from its constructor position) and whenever interpolation is disabled.
    if (!this.interpolated || !this.hasSnapshot) {
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
