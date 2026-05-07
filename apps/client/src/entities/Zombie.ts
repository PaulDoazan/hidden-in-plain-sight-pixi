import { AnimatedSprite, Container, Rectangle, Texture } from 'pixi.js'
import type { ZombieAnimation, ZombieType } from '@hips/shared'

import { SPRITE_FRAME_HEIGHT, SPRITE_FRAME_WIDTH } from '../config/manifest'
import type { AABB } from '../systems/CollisionDetector'

export interface ZombieDeps {
  type: ZombieType
  textures: Record<ZombieAnimation, Texture>
  frameCounts: Record<ZombieAnimation, number>
}

export abstract class Zombie extends Container {
  readonly id: string
  readonly type: ZombieType
  isAlive = true
  private current: ZombieAnimation = 'idle'
  private readonly sprites: Record<ZombieAnimation, AnimatedSprite>

  constructor(deps: ZombieDeps) {
    super()
    this.id = `${deps.type}-${Math.random().toString(36).slice(2, 8)}`
    this.type = deps.type

    const animations: ZombieAnimation[] = ['walk', 'idle', 'die', 'run']
    this.sprites = {} as Record<ZombieAnimation, AnimatedSprite>
    for (const anim of animations) {
      const tex = deps.textures[anim]
      const count = deps.frameCounts[anim]
      const frames: Texture[] = []
      // zombie sheets are single-row, so cols = count
      for (let i = 0; i < count; i++) {
        const frame = new Texture({
          source: tex.source,
          frame: new Rectangle(
            i * SPRITE_FRAME_WIDTH,
            0,
            SPRITE_FRAME_WIDTH,
            SPRITE_FRAME_HEIGHT,
          ),
        })
        frames.push(frame)
      }
      const sprite = new AnimatedSprite(frames)
      sprite.anchor.set(0.5, 1)
      sprite.animationSpeed = 0.15
      sprite.loop = anim !== 'die'
      sprite.visible = false
      sprite.stop()
      this.sprites[anim] = sprite
      this.addChild(sprite)
    }

    this.playAnimation('idle')
  }

  playAnimation(name: ZombieAnimation): void {
    if (this.current === name) return
    for (const key of Object.keys(this.sprites) as ZombieAnimation[]) {
      const s = this.sprites[key]
      if (key === name) {
        s.visible = true
        s.gotoAndPlay(0)
      } else {
        s.visible = false
        s.stop()
      }
    }
    this.current = name
  }

  get aabb(): AABB {
    return {
      x: this.x - SPRITE_FRAME_WIDTH / 2,
      y: this.y - SPRITE_FRAME_HEIGHT,
      width: SPRITE_FRAME_WIDTH,
      height: SPRITE_FRAME_HEIGHT,
    }
  }

  die(): void {
    if (!this.isAlive) return
    this.isAlive = false
    this.playAnimation('die')
  }

  abstract update(delta: number): void
}
