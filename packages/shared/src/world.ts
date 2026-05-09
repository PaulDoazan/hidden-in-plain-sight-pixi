export const WORLD_WIDTH = 1920
export const WORLD_HEIGHT = 886

// Margin from the right edge to the dashed arrival line, in world units.
// Matches the existing client value (apps/client/src/config/gameConfig.ts).
export const ARRIVAL_LINE_MARGIN = 80
export const ARRIVAL_LINE_X = WORLD_WIDTH - ARRIVAL_LINE_MARGIN

export const SERVER_TICK_HZ = 30

// Movement speeds are expressed in px/frame at a 60 FPS reference, matching
// the existing client tuning. The server scales them to its tick rate via
// `pxPerTick = pxPerFrame * (60 / SERVER_TICK_HZ)`.
export const WALK_SPEED = 0.5
export const RUN_SPEED = 1.2

// Spawn positions: every player spawns somewhere in this band on the x axis.
export const SPAWN_BAND_X = 30
export const SPAWN_BAND_WIDTH = 40
