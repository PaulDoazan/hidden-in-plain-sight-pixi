import type { ZombieType, ZombieAnimation } from '@hips/shared'

export interface SpriteSheetEntry {
  alias: string
  src: string
  frameCount: number
  frameWidth: number
  frameHeight: number
  cols: number
}

export interface ImageEntry {
  alias: string
  src: string
}

export const SPRITE_FRAME_WIDTH = 96
export const SPRITE_FRAME_HEIGHT = 96

const ZOMBIE_FRAME_COUNTS: Record<ZombieType, Record<ZombieAnimation, number>> = {
  man:   { walk: 8,  idle: 8, die: 5, run: 7 },
  woman: { walk: 7,  idle: 5, die: 5, run: 7 },
  wild:  { walk: 10, idle: 9, die: 5, run: 8 },
}

function zombieEntry(type: ZombieType, anim: ZombieAnimation): SpriteSheetEntry {
  const fileName: Record<ZombieType, Record<ZombieAnimation, string>> = {
    man:   { walk: 'walk.png',  idle: 'idle.png', die: 'die.png',  run: 'Run.png' },
    woman: { walk: 'walk.png',  idle: 'idle.png', die: 'die.png',  run: 'Run.png' },
    wild:  { walk: 'Walk.png',  idle: 'Idle.png', die: 'Dead.png', run: 'Run.png' },
  }
  const count = ZOMBIE_FRAME_COUNTS[type][anim]
  return {
    alias: `${type}_${anim}`,
    src: `/assets/${type}/${fileName[type][anim]}`,
    frameCount: count,
    frameWidth: SPRITE_FRAME_WIDTH,
    frameHeight: SPRITE_FRAME_HEIGHT,
    cols: count,
  }
}

export const ZOMBIE_SPRITES: SpriteSheetEntry[] = (
  ['man', 'woman', 'wild'] as const
).flatMap((type) =>
  (['walk', 'idle', 'die', 'run'] as const).map((anim) => zombieEntry(type, anim)),
)

export const SHOT_SPRITES: SpriteSheetEntry[] = [
  {
    alias: 'bloodShot',
    src: '/assets/shots/bloodShot.png',
    frameCount: 16,
    frameWidth: 215,
    frameHeight: 205,
    cols: 4,
  },
]

export const BACKGROUND_IMAGES: ImageEntry[] = [
  { alias: 'bg1', src: '/assets/backgrounds/background_1.jpg' },
  { alias: 'bg2', src: '/assets/backgrounds/background_2.jpg' },
]
