import { Container, Graphics } from 'pixi.js'

// Screen-space blast played when somebody sets off the Bombe bonus: a short
// flash over the whole viewport and a shockwave ring racing out from its
// centre.
//
// Both shapes are drawn exactly once and then animated through their
// transform. PixiJS tessellates Graphics geometry into GPU triangles when it
// is drawn, so clearing and redrawing the ring every frame would rebuild that
// geometry sixty times a second; growing it with `scale` costs a matrix.
const DURATION_MS = 700
// The ring is drawn at its final size and scaled up into it, so the stroke
// starts thin and thickens as it expands. Fading it out over the same window
// reads as the wave dissipating rather than as a widening band.
const RING_RADIUS = 520
const RING_START_SCALE = 0.05
// The flash is done well before the ring, so it reads as the detonation
// rather than as a tint over the whole effect.
const FLASH_FADE_RATIO = 0.35
const FLASH_PEAK_ALPHA = 0.45

export class BombBlast extends Container {
  private readonly flash: Graphics
  private readonly ring: Graphics
  private elapsedMs = 0

  constructor(width: number, height: number) {
    super()

    // Additive rather than a white veil: the playfield burns towards light
    // instead of being washed out flat.
    this.flash = new Graphics().rect(0, 0, width, height).fill(0xffb347)
    this.flash.blendMode = 'add'
    this.flash.alpha = FLASH_PEAK_ALPHA

    this.ring = new Graphics()
      .circle(0, 0, RING_RADIUS)
      .stroke({ width: 10, color: 0xffd166 })
    this.ring.position.set(width / 2, height / 2)
    this.ring.scale.set(RING_START_SCALE)

    this.addChild(this.flash, this.ring)
  }

  // Advances the animation. Returns false once it has played out, at which
  // point it has destroyed itself and the caller must drop its reference.
  update(deltaMs: number): boolean {
    this.elapsedMs += deltaMs
    const t = Math.min(1, this.elapsedMs / DURATION_MS)

    // Decelerating expansion: fast at the detonation, coasting at the edge.
    const eased = 1 - (1 - t) ** 3
    this.ring.scale.set(RING_START_SCALE + (1 - RING_START_SCALE) * eased)
    this.ring.alpha = 1 - t
    this.flash.alpha = FLASH_PEAK_ALPHA * Math.max(0, 1 - t / FLASH_FADE_RATIO)

    if (t < 1) return true
    this.destroy({ children: true })
    return false
  }
}
