import { Container, Graphics } from 'pixi.js'

import { CROSSHAIR_COLOR, CROSSHAIR_RADIUS } from '../config/gameConfig'

export class Crosshair extends Container {
  readonly radius = CROSSHAIR_RADIUS
  private color: number
  private readonly ring: Graphics
  private readonly dashes: Graphics

  constructor(color: number = CROSSHAIR_COLOR) {
    super()

    this.color = color
    this.ring = new Graphics()
    this.dashes = new Graphics()
    this.addChild(this.ring, this.dashes)
    this.redraw()
  }

  setColor(color: number): void {
    if (this.color === color) return
    this.color = color
    this.redraw()
  }

  private redraw(): void {
    const r = CROSSHAIR_RADIUS
    this.ring
      .clear()
      .circle(0, 0, r)
      .stroke({ width: 2, color: this.color })
      .circle(0, 0, r * 0.75)
      .stroke({ width: 2, color: this.color, alpha: 0.5 })

    this.dashes
      .clear()
      .moveTo(0, -r - r / 2)
      .lineTo(0, -r + r / 2)
      .moveTo(r - r / 2, 0)
      .lineTo(r + r / 2, 0)
      .moveTo(0, r - r / 2)
      .lineTo(0, r + r / 2)
      .moveTo(-r - r / 2, 0)
      .lineTo(-r + r / 2, 0)
      .stroke({ width: 2, color: this.color })
  }
}
