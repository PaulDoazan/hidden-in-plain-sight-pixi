import type { GameConfig } from '@hips/shared'

// Virtual world: a fixed-size coordinate system. Every entity position, speed,
// and the arrival line are expressed in these units. The GameScene scales the
// gameLayer so the world fits the on-screen play area, which keeps gameplay
// proportions identical across screen sizes — critical for the Phase 2 multi-
// player where each client may have a different resolution.
export const WORLD_WIDTH = 1920
export const WORLD_HEIGHT = 886

export const defaultGameConfig: GameConfig = {
  numBots: 20,
  walkSpeed: 0.5,
  runSpeed: 1.2,
  // TODO Phase 1 testing: keep ammo infinite so we can stress-test aim precision
  // on adjacent zombies. Switch back to 1 (or read from a config screen) before
  // shipping multiplayer.
  bulletsPerPlayer: Infinity,
  playAreaRatio: WORLD_WIDTH / WORLD_HEIGHT,
}

// Debug: render each zombie's collision AABB as a translucent blue rectangle
// so the player can visualise aim precision during testing. Set to false
// before shipping.
export const DEBUG_HITBOXES = true

export const CROSSHAIR_RADIUS = 25
// Distance from the right edge of the world to the arrival line (world units).
export const ARRIVAL_LINE_MARGIN = 80
// Vertical offset where the dashed arrival line starts (top edge in world units).
// The line then extends down to WORLD_HEIGHT.
export const ARRIVAL_LINE_TOP_Y = 250
export const CROSSHAIR_COLOR = 0xfff700
