import { Container, Graphics } from 'pixi.js'

import { CROSSHAIR_COLOR, CROSSHAIR_RADIUS } from '../config/gameConfig'

export class Crosshair extends Container {
  readonly radius = CROSSHAIR_RADIUS

  constructor() {
    super()

    const r = CROSSHAIR_RADIUS
    const ring = new Graphics()
      .circle(0, 0, r)
      .stroke({ width: 2, color: CROSSHAIR_COLOR })
      .circle(0, 0, r * 0.75)
      .stroke({ width: 2, color: CROSSHAIR_COLOR, alpha: 0.5 })

    const dashes = new Graphics()
      .moveTo(0, -r - r / 2).lineTo(0, -r + r / 2)
      .moveTo(r - r / 2, 0).lineTo(r + r / 2, 0)
      .moveTo(0, r - r / 2).lineTo(0, r + r / 2)
      .moveTo(-r - r / 2, 0).lineTo(-r + r / 2, 0)
      .stroke({ width: 2, color: CROSSHAIR_COLOR })

    this.addChild(ring, dashes)
  }
}
