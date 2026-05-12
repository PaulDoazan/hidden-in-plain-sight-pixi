import { Container, Graphics, type FederatedPointerEvent, Text } from 'pixi.js'

const BUTTON_SIZE = 22
const BUTTON_GAP = 16
const MARGIN_X = 12
const MARGIN_Y = 12
const LABEL_FONT_SIZE = 12

export interface MobileControlsOptions {
  canvasHeight: number
  onWalkDown: () => void
  onWalkUp: () => void
  onRunDown: () => void
  onRunUp: () => void
  onFire: () => void
}

// Bottom-left column of touch controls: Walk (top), Run (middle), Fire (bottom).
// Walk/Run are hold buttons — they activate while a finger is pressed and
// release on lift, lift-outside, or pointercancel (multi-touch scenarios).
// Each button calls `stopPropagation()` so the scene's touch-drag surface
// doesn't also react to the same touch.
export class MobileControls extends Container {
  private readonly walkBtn: HoldButton
  private readonly runBtn: HoldButton
  private readonly fireBtn: TapButton
  private canvasHeight: number

  constructor(opts: MobileControlsOptions) {
    super()
    this.canvasHeight = opts.canvasHeight

    this.walkBtn = new HoldButton({
      label: 'M',
      fillColor: 0x1f2937,
      activeFillColor: 0x3b5468,
      onDown: opts.onWalkDown,
      onUp: opts.onWalkUp,
    })
    this.runBtn = new HoldButton({
      label: 'C',
      fillColor: 0x1f2937,
      activeFillColor: 0x3b5468,
      onDown: opts.onRunDown,
      onUp: opts.onRunUp,
    })
    this.fireBtn = new TapButton({
      label: 'T',
      fillColor: 0x5a1010,
      activeFillColor: 0x7d1818,
      onTap: opts.onFire,
    })

    this.addChild(this.walkBtn, this.runBtn, this.fireBtn)
    this.layout()
  }

  resize(canvasHeight: number): void {
    this.canvasHeight = canvasHeight
    this.layout()
  }

  // Cancel any held buttons — used when the scene tears down so dangling
  // virtual key state doesn't leak across scenes.
  releaseAll(): void {
    this.walkBtn.forceRelease()
    this.runBtn.forceRelease()
  }

  private layout(): void {
    const cx = MARGIN_X + BUTTON_SIZE / 2
    const bottomCenterY = this.canvasHeight - MARGIN_Y - BUTTON_SIZE / 2
    this.fireBtn.position.set(cx, bottomCenterY)
    this.runBtn.position.set(cx, bottomCenterY - (BUTTON_SIZE + BUTTON_GAP))
    this.walkBtn.position.set(cx, bottomCenterY - 2 * (BUTTON_SIZE + BUTTON_GAP))
  }
}

interface BaseButtonStyle {
  label: string
  fillColor: number
  activeFillColor: number
}

class HoldButton extends Container {
  private readonly bg: Graphics
  private readonly fillColor: number
  private readonly activeFillColor: number
  private isActive = false
  private readonly onDown: () => void
  private readonly onUp: () => void

  constructor(opts: BaseButtonStyle & { onDown: () => void; onUp: () => void }) {
    super()
    this.fillColor = opts.fillColor
    this.activeFillColor = opts.activeFillColor
    this.onDown = opts.onDown
    this.onUp = opts.onUp

    this.bg = new Graphics()
    this.addChild(this.bg)
    this.drawBg(false)

    const label = new Text({
      text: opts.label,
      style: {
        fill: 0xfff700,
        fontSize: LABEL_FONT_SIZE,
        fontFamily: 'Space Mono, monospace',
      },
    })
    label.anchor.set(0.5)
    this.addChild(label)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointerdown', this.handleDown)
    this.on('pointerup', this.handleUp)
    this.on('pointerupoutside', this.handleUp)
    this.on('pointercancel', this.handleUp)
  }

  forceRelease(): void {
    if (!this.isActive) return
    this.isActive = false
    this.drawBg(false)
    this.onUp()
  }

  private handleDown = (event: FederatedPointerEvent) => {
    event.stopPropagation()
    if (this.isActive) return
    this.isActive = true
    this.drawBg(true)
    this.onDown()
  }

  private handleUp = (event?: FederatedPointerEvent) => {
    event?.stopPropagation()
    if (!this.isActive) return
    this.isActive = false
    this.drawBg(false)
    this.onUp()
  }

  private drawBg(active: boolean): void {
    this.bg
      .clear()
      .roundRect(-BUTTON_SIZE / 2, -BUTTON_SIZE / 2, BUTTON_SIZE, BUTTON_SIZE, 4)
      .fill({ color: active ? this.activeFillColor : this.fillColor, alpha: 0.85 })
      .stroke({ width: 2, color: 0xfff700 })
  }
}

class TapButton extends Container {
  private readonly bg: Graphics
  private readonly fillColor: number
  private readonly activeFillColor: number
  private readonly onTap: () => void
  private flashTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: BaseButtonStyle & { onTap: () => void }) {
    super()
    this.fillColor = opts.fillColor
    this.activeFillColor = opts.activeFillColor
    this.onTap = opts.onTap

    this.bg = new Graphics()
    this.addChild(this.bg)
    this.drawBg(false)

    const label = new Text({
      text: opts.label,
      style: {
        fill: 0xffe0e0,
        fontSize: LABEL_FONT_SIZE,
        fontFamily: 'Space Mono, monospace',
      },
    })
    label.anchor.set(0.5)
    this.addChild(label)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointerdown', this.handleDown)
  }

  private handleDown = (event: FederatedPointerEvent) => {
    event.stopPropagation()
    this.onTap()
    this.drawBg(true)
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.drawBg(false)
      this.flashTimer = null
    }, 120)
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer)
      this.flashTimer = null
    }
    super.destroy(options)
  }

  private drawBg(active: boolean): void {
    this.bg
      .clear()
      .roundRect(-BUTTON_SIZE / 2, -BUTTON_SIZE / 2, BUTTON_SIZE, BUTTON_SIZE, 4)
      .fill({ color: active ? this.activeFillColor : this.fillColor, alpha: 0.9 })
      .stroke({ width: 2, color: 0xff5252 })
  }
}
