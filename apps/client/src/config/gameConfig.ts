import type { GameConfig } from '@hips/shared'

export const defaultGameConfig: GameConfig = {
  numBots: 20,
  walkSpeed: 0.5,
  runSpeed: 1.2,
  bulletsPerPlayer: 1,
  playAreaRatio: 19.5 / 9,
}

export const CROSSHAIR_RADIUS = 25
export const ARRIVAL_LINE_MARGIN = 30
export const CROSSHAIR_COLOR = 0xfff700
