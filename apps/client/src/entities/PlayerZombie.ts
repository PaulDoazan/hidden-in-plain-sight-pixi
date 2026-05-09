import type { PlayerState } from '@hips/shared'

import { Zombie, type ZombieDeps } from './Zombie'

export class PlayerZombie extends Zombie {
  // PlayerZombie no longer reads input directly; it is a pure renderer
  // driven by server state. The Zombie base class handles animation switching
  // and aabb computation; this class is only responsible for applying snapshots.
  constructor(deps: ZombieDeps) {
    super(deps)
  }

  applyServerState(state: PlayerState): void {
    this.x = state.x
    this.y = state.y
    if (state.isAlive !== this.isAlive) {
      if (!state.isAlive) this.die()
    }
    this.playAnimation(state.animation)
  }

  override update(_delta: number): void {
    // No local logic. Server snapshots drive position and animation via
    // applyServerState() called from GameScene.
  }
}
