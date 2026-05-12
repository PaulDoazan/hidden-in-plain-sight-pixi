import { AnimatedSprite, Container, Graphics, Rectangle, Texture } from 'pixi.js'
import type { ZombieAnimation, ZombieType } from '@hips/shared'

import { DEBUG_HITBOXES } from '../config/gameConfig'
import { SPRITE_FRAME_HEIGHT, SPRITE_FRAME_WIDTH, ZOMBIE_BODY_BOX } from '../config/manifest'
import type { AABB } from '../systems/CollisionDetector'

export interface ZombieDeps {
  type: ZombieType
  textures: Record<ZombieAnimation, Texture>
  frameCounts: Record<ZombieAnimation, number>
}

export abstract class Zombie extends Container {
  readonly type: ZombieType
  isAlive = true
  private current: ZombieAnimation | null = null
  private readonly sprites: Record<ZombieAnimation, AnimatedSprite>

  constructor(deps: ZombieDeps) {
    super()
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

    if (DEBUG_HITBOXES) {
      // Translucent blue rectangle matching the AABB returned by `get aabb()`.
      // Anchor (0.5, 1) maps local (0, 0) to the bottom-center, so the rect
      // spans x ∈ [-W/2, W/2] and y ∈ [-H, 0] using the per-type body box.
      const box = ZOMBIE_BODY_BOX[deps.type]
      const hitbox = new Graphics()
        .rect(-box.width / 2, -box.height, box.width, box.height)
        .fill({ color: 0x4488ff, alpha: 0.1 })
      this.addChild(hitbox)
    }
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
    // The hit box follows whatever scale the zombie has been given (e.g. 2× on
    // small screens — see GameScene.makeZombie), so the visual sprite and the
    // click target stay aligned. The box is per-type to track
    // the zombie's actual silhouette (standing vs. crawling), not the full
    // 96×96 frame.
    const sx = this.scale.x
    const sy = this.scale.y
    const box = ZOMBIE_BODY_BOX[this.type]
    return {
      x: this.x - (box.width * sx) / 2,
      y: this.y - box.height * sy,
      width: box.width * sx,
      height: box.height * sy,
    }
  }

  die(): void {
    if (!this.isAlive) return
    this.isAlive = false
    this.playAnimation('die')
  }

  abstract update(delta: number): void
}
