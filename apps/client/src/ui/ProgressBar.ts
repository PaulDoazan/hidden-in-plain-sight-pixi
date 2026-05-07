import { Container, Graphics } from 'pixi.js'

export class ProgressBar extends Container {
  private readonly fill: Graphics
  private readonly w: number
  private readonly h: number

  constructor(width = 400, height = 16) {
    super()
    this.w = width
    this.h = height

    const track = new Graphics()
      .roundRect(-width / 2, -height / 2, width, height, height / 2)
      .fill({ color: 0x111827 })
      .stroke({ width: 2, color: 0xfff700 })

    this.fill = new Graphics()
    this.addChild(track, this.fill)
    this.set(0)
  }

  set(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress))
    this.fill.clear()
    if (clamped > 0) {
      this.fill
        .roundRect(-this.w / 2 + 2, -this.h / 2 + 2, (this.w - 4) * clamped, this.h - 4, this.h / 2)
        .fill({ color: 0xfff700 })
    }
  }
}
