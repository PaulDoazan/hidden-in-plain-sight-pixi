import type { InputManager } from '../systems/InputManager'

import { Zombie, type ZombieDeps } from './Zombie'

export interface PlayerZombieDeps extends ZombieDeps {
  input: InputManager
  walkSpeed: number
  runSpeed: number
}

export class PlayerZombie extends Zombie {
  private readonly input: InputManager
  private readonly walkSpeed: number
  private readonly runSpeed: number

  constructor(deps: PlayerZombieDeps) {
    super(deps)
    this.input = deps.input
    this.walkSpeed = deps.walkSpeed
    this.runSpeed = deps.runSpeed
  }

  override update(_delta: number): void {
    if (!this.isAlive) return
    const spaceDown = this.input.isDown(' ')
    const shiftDown = this.input.isDown('Shift')

    if (spaceDown && shiftDown) {
      this.playAnimation('run')
      this.x += this.runSpeed
    } else if (spaceDown) {
      this.playAnimation('walk')
      this.x += this.walkSpeed
    } else {
      this.playAnimation('idle')
    }
  }
}
