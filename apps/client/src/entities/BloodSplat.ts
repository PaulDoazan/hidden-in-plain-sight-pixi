import { AnimatedSprite, Container, Rectangle, Texture } from 'pixi.js'

import { SHOT_SPRITES } from '../config/manifest'
import type { AssetLoader } from '../systems/AssetLoader'

export class BloodSplat extends Container {
  private readonly sprite: AnimatedSprite

  constructor(assets: AssetLoader) {
    super()

    const meta = SHOT_SPRITES.find((s) => s.alias === 'bloodShot')!
    const tex = assets.get('bloodShot')

    const frames: Texture[] = []
    for (let i = 0; i < meta.frameCount; i++) {
      const col = i % meta.cols
      const row = Math.floor(i / meta.cols)
      frames.push(
        new Texture({
          source: tex.source,
          frame: new Rectangle(
            col * meta.frameWidth,
            row * meta.frameHeight,
            meta.frameWidth,
            meta.frameHeight,
          ),
        }),
      )
    }

    this.sprite = new AnimatedSprite(frames)
    this.sprite.anchor.set(0.5)
    this.sprite.animationSpeed = 0.7
    this.sprite.loop = false
    this.sprite.scale.set(0.5)
    this.sprite.onComplete = () => this.destroy({ children: true })
    this.sprite.gotoAndPlay(0)
    this.addChild(this.sprite)
  }
}
