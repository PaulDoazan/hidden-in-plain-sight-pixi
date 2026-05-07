import { Zombie, type ZombieDeps } from './Zombie'

export interface BotState {
  canMove: boolean
  countTick: number
  x: number
}

export interface BotCycleConfig {
  minTick: number
  maxTick: number
  walkSpeed: number
}

export function tickBotState(
  state: BotState,
  cycle: BotCycleConfig,
  rng: () => number,
): BotState {
  const next: BotState = { ...state }
  next.countTick -= 1
  if (next.countTick <= 0) {
    next.canMove = !next.canMove
    const range = cycle.maxTick - cycle.minTick
    next.countTick = Math.floor(rng() * range) + cycle.minTick
  }
  if (next.canMove) {
    next.x = state.x + cycle.walkSpeed
  }
  return next
}

export interface BotDeps extends ZombieDeps {
  cycle: BotCycleConfig
  rng?: () => number
}

const integerSeq = () => Math.floor(Math.random() * 1_000_000)

export class Bot extends Zombie {
  private state: BotState
  private readonly cycle: BotCycleConfig
  private readonly rng: () => number

  constructor(deps: BotDeps) {
    super(deps)
    this.cycle = deps.cycle
    this.rng = deps.rng ?? Math.random
    const range = deps.cycle.maxTick - deps.cycle.minTick
    this.state = {
      canMove: false,
      countTick: (integerSeq() % range) + deps.cycle.minTick,
      x: this.x,
    }
  }

  override update(_delta: number): void {
    if (!this.isAlive) return
    const previous = this.state
    this.state = tickBotState(this.state, this.cycle, this.rng)
    this.x = this.state.x

    if (previous.canMove !== this.state.canMove) {
      this.playAnimation(this.state.canMove ? 'walk' : 'idle')
    }
  }
}
