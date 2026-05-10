import { Container, Graphics } from 'pixi.js'

export type IconKind = 'copy' | 'check'

export interface IconButtonOptions {
  size?: number
  color?: number
  bgColor?: number
  borderColor?: number
  initialIcon?: IconKind
  onClick: () => void
}

// Square icon button with a Pixi-drawn glyph (no font/SVG asset). The glyph
// shapes are MDI-inspired so the look is consistent without pulling in an
// icon webfont. `setIcon()` lets callers toggle between copy/check after a
// successful clipboard write.
export class IconButton extends Container {
  private readonly size: number
  private readonly color: number
  private readonly bg: Graphics
  private readonly glyph: Graphics

  constructor(opts: IconButtonOptions) {
    super()
    this.size = opts.size ?? 40
    this.color = opts.color ?? 0xfff700
    const bgColor = opts.bgColor ?? 0x1f2937
    const borderColor = opts.borderColor ?? 0xfff700

    this.bg = new Graphics()
      .roundRect(-this.size / 2, -this.size / 2, this.size, this.size, 8)
      .fill({ color: bgColor })
      .stroke({ width: 2, color: borderColor })
    this.addChild(this.bg)

    this.glyph = new Graphics()
    this.addChild(this.glyph)
    this.drawIcon(opts.initialIcon ?? 'copy')

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', opts.onClick)
  }

  setIcon(kind: IconKind): void {
    this.drawIcon(kind)
  }

  private drawIcon(kind: IconKind): void {
    this.glyph.clear()
    if (kind === 'copy') this.drawCopy()
    else this.drawCheck()
  }

  // MDI `content_copy`: two overlapping rounded squares.
  private drawCopy(): void {
    const s = this.size * 0.5 // glyph extent
    const back = s * 0.7
    const front = s * 0.7
    const offset = s * 0.18
    // Back rectangle (slightly behind, top-left)
    this.glyph
      .roundRect(-back / 2 - offset, -back / 2 - offset, back, back, 3)
      .stroke({ width: 2, color: this.color })
    // Front rectangle (overlapping, bottom-right) — filled bg color to occlude
    // the back rect where they overlap, mimicking MDI's solid-on-outline look.
    this.glyph
      .roundRect(-front / 2 + offset, -front / 2 + offset, front, front, 3)
      .fill({ color: 0x1f2937 })
      .stroke({ width: 2, color: this.color })
  }

  // MDI `check`: a single check-mark stroke.
  private drawCheck(): void {
    const s = this.size * 0.5
    this.glyph
      .moveTo(-s * 0.55, 0)
      .lineTo(-s * 0.12, s * 0.4)
      .lineTo(s * 0.6, -s * 0.45)
      .stroke({ width: 3, color: this.color, cap: 'round', join: 'round' })
  }
}
