import {
  ARRIVAL_LINE_MARGIN as SHARED_ARRIVAL_LINE_MARGIN,
  RUN_SPEED,
  WALK_SPEED,
  WORLD_HEIGHT as SHARED_WORLD_HEIGHT,
  WORLD_WIDTH as SHARED_WORLD_WIDTH,
  type GameConfig,
} from '@hips/shared'

// Re-export under the existing names so client call sites don't change.
export const WORLD_WIDTH = SHARED_WORLD_WIDTH
export const WORLD_HEIGHT = SHARED_WORLD_HEIGHT
export const ARRIVAL_LINE_MARGIN = SHARED_ARRIVAL_LINE_MARGIN

export const defaultGameConfig: GameConfig = {
  numBots: 20,
  walkSpeed: WALK_SPEED,
  runSpeed: RUN_SPEED,
  bulletsPerPlayer: 1,
  playAreaRatio: WORLD_WIDTH / WORLD_HEIGHT,
}

// Debug: render each zombie's collision AABB as a translucent blue rectangle.
export const DEBUG_HITBOXES = false

export const CROSSHAIR_RADIUS = 25
// Vertical offset where the dashed arrival line starts (top edge in world
// units). Aligned with the topmost zombie spawn y (host) so the line and
// the lineup share the same upper boundary.
export const ARRIVAL_LINE_TOP_Y = WORLD_HEIGHT * (2 / 5)
export const CROSSHAIR_COLOR = 0xfff700
