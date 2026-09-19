import { Container, Graphics } from 'pixi.js'

// Blue halo that flares around a zombie whose Gilet has just swallowed a
// lethal shot. Everyone in the room sees it, which is the point: the bonus
// saves you and gives you away in the same beat.
//
// Like BombBlast, both shapes are drawn exactly once and animated through
// their transform alone — PixiJS tessellates Graphics geometry when it is
// drawn, so redrawing per frame would rebuild it sixty times a second.
const DURATION_MS = 500
const START_SCALE = 0.45
const END_SCALE = 1.5
const DISC_ALPHA = 0.45

export class ShieldHalo extends Container {
  private readonly disc: Graphics
  private readonly ring: Graphics
  private elapsedMs = 0

  constructor(radius: number) {
    super()

    // Additive, so the halo reads as light cast on the zombie rather than a
    // blue disc pasted over it.
    this.disc = new Graphics().circle(0, 0, radius).fill(0x4da6ff)
    this.disc.blendMode = 'add'
    this.disc.alpha = DISC_ALPHA

    this.ring = new Graphics().circle(0, 0, radius).stroke({ width: 5, color: 0x9ad4ff })

    this.addChild(this.disc, this.ring)
    this.scale.set(START_SCALE)
  }

  // Advances the animation. Returns false once it has played out, at which
  // point it has destroyed itself and the caller must drop its reference.
  update(deltaMs: number): boolean {
    this.elapsedMs += deltaMs
    const t = Math.min(1, this.elapsedMs / DURATION_MS)

    // Decelerating bloom: it snaps open on impact, then drifts outwards.
    const eased = 1 - (1 - t) ** 3
    this.scale.set(START_SCALE + (END_SCALE - START_SCALE) * eased)
    // The fill clears faster than the outline, so what lingers is a rim of
    // light rather than a blue smear over the sprite.
    this.disc.alpha = DISC_ALPHA * (1 - t) ** 2
    this.ring.alpha = 1 - t

    if (t < 1) return true
    this.destroy({ children: true })
    return false
  }
}
