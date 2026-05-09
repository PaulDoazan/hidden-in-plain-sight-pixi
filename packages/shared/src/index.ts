export * from './zombie'
import type { ZombieAnimation, ZombieType } from './zombie'

export interface GameConfig {
  numBots: number
  walkSpeed: number
  runSpeed: number
  bulletsPerPlayer: number
  playAreaRatio: number
}

export interface ZombieState {
  id: string
  type: ZombieType
  x: number
  y: number
  animation: ZombieAnimation
  isAlive: boolean
}

export * from './world'
export * from './events'
