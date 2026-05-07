export type ZombieType = 'man' | 'woman' | 'wild'
export type ZombieAnimation = 'walk' | 'idle' | 'die' | 'run'

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
