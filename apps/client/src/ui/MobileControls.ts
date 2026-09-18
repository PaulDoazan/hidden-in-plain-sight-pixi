import {
  Container,
  Graphics,
  GraphicsPath,
  type FederatedPointerEvent,
  Text,
} from 'pixi.js'

const BUTTON_SIZE = 44
const BUTTON_GAP = 28
const MARGIN_X = 12
const MARGIN_Y = 12
const LABEL_FONT_SIZE = 24
// Vertical center of the Walk/Run column, as a fraction of canvas height.
// Sits in the lower-left region — within the natural arc of the left thumb
// when the phone is held in landscape — yet lifted off the bottom corner so
// the hold buttons stay comfortable to press.
const COLUMN_CENTER_Y_RATIO = 0.62

export interface MobileControlsOptions {
  canvasWidth: number
  canvasHeight: number
  onWalkDown: () => void
  onWalkUp: () => void
  onRunDown: () => void
  onRunUp: () => void
  onBonus: () => void
}

// Lower-left column of touch controls: Walk (top), Run (bottom). Both are
// hold buttons — they activate while a finger is pressed and release on lift,
// lift-outside, or pointercancel (multi-touch scenarios). A fullscreen toggle
// sits in the top-right corner. Firing is handled by a double-tap on the
// scene's touch-drag surface, so there is no on-screen fire button.
// Each button calls `stopPropagation()` so the scene's touch-drag surface
// doesn't also react to the same touch.
export class MobileControls extends Container {
  private readonly walkBtn: HoldButton
  private readonly runBtn: HoldButton
  private readonly bonusBtn: HoldButton
  private readonly fullscreenBtn: IconButton
  private canvasWidth: number
  private canvasHeight: number

  constructor(opts: MobileControlsOptions) {
    super()
    this.canvasWidth = opts.canvasWidth
    this.canvasHeight = opts.canvasHeight

    this.walkBtn = new HoldButton({
      icon: drawWalkIcon,
      fillColor: 0x1f2937,
      activeFillColor: 0x3b5468,
      onDown: opts.onWalkDown,
      onUp: opts.onWalkUp,
    })
    this.runBtn = new HoldButton({
      icon: drawRunIcon,
      fillColor: 0x1f2937,
      activeFillColor: 0x3b5468,
      onDown: opts.onRunDown,
      onUp: opts.onRunUp,
    })
    this.bonusBtn = new HoldButton({
      icon: drawBonusIcon,
      fillColor: 0x1f2937,
      activeFillColor: 0x3b5468,
      onDown: opts.onBonus,
      // Tap, not hold: everything happens on the press.
      onUp: () => {},
    })
    // Hidden until the player drafts an active bonus.
    this.bonusBtn.visible = false
    this.fullscreenBtn = new IconButton({
      fillColor: 0x1f2937,
      activeFillColor: 0x3b5468,
    })

    this.addChild(this.walkBtn, this.runBtn, this.bonusBtn, this.fullscreenBtn)
    this.layout()
  }

  resize(canvasWidth: number, canvasHeight: number): void {
    this.canvasWidth = canvasWidth
    this.canvasHeight = canvasHeight
    this.layout()
  }

  // Cancel any held buttons — used when the scene tears down so dangling
  // virtual key state doesn't leak across scenes.
  releaseAll(): void {
    this.walkBtn.forceRelease()
    this.runBtn.forceRelease()
  }

  setBonusAvailable(available: boolean): void {
    this.bonusBtn.visible = available
  }

  private layout(): void {
    const cx = MARGIN_X + BUTTON_SIZE / 2
    // Walk on top, Run below, centered vertically on COLUMN_CENTER_Y_RATIO so
    // the left thumb can reach both without leaving its natural landscape grip.
    const columnCenterY = this.canvasHeight * COLUMN_CENTER_Y_RATIO
    const halfSpan = (BUTTON_SIZE + BUTTON_GAP) / 2
    this.walkBtn.position.set(cx, columnCenterY - halfSpan)
    this.runBtn.position.set(cx, columnCenterY + halfSpan)
    // Same edge-to-edge gap (BUTTON_GAP) above Walk as Walk has below it to
    // Run, rather than half of it — otherwise a mis-tap reaching for Walk can
    // land on Bonus and burn a one-charge bonus irreversibly.
    this.bonusBtn.position.set(cx, columnCenterY - halfSpan - BUTTON_SIZE - BUTTON_GAP)
    this.fullscreenBtn.position.set(
      this.canvasWidth - MARGIN_X - BUTTON_SIZE / 2,
      MARGIN_Y + BUTTON_SIZE / 2,
    )
  }
}

// Theme color shared by the walk/run pictograms and the fullscreen glyph.
const ICON_COLOR = 0xfff700
// Pictograms are authored on Material Icons' 24×24 viewBox; HoldButton pivots
// on its center and scales it to fit the button.
const ICON_VIEWBOX = 24
const ICON_SCALE = 1.15

// Material Icons "directions_walk" / "directions_run" (filled, 24×24 viewBox),
// rendered as fillable GraphicsPaths so they take the UI's yellow like the
// previous letters did. Path data from @material-design-icons/svg.
const WALK_SVG_PATH =
  'M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7'
const RUN_SVG_PATH =
  'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9 1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z'

function drawWalkIcon(g: Graphics): void {
  g.clear().path(new GraphicsPath(WALK_SVG_PATH)).fill({ color: ICON_COLOR })
}

function drawRunIcon(g: Graphics): void {
  g.clear().path(new GraphicsPath(RUN_SVG_PATH)).fill({ color: ICON_COLOR })
}

// A star, drawn on the same 24×24 viewBox as the other pictograms so
// HoldButton's centering and scaling apply unchanged.
function drawBonusIcon(g: Graphics): void {
  g.clear().star(12, 12, 5, 11, 5).fill({ color: ICON_COLOR })
}

interface BaseButtonStyle {
  icon: (g: Graphics) => void
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

    const icon = new Graphics()
    opts.icon(icon)
    // Center the 24×24 viewBox on the button and scale it to fit.
    icon.pivot.set(ICON_VIEWBOX / 2, ICON_VIEWBOX / 2)
    icon.scale.set(ICON_SCALE)
    this.addChild(icon)

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

// Top-right fullscreen toggle. Drives the Fullscreen API and listens to
// `fullscreenchange` so the icon stays in sync even when the user exits
// fullscreen via the OS/browser (e.g. swipe or Esc) rather than the button.
class IconButton extends Container {
  private readonly bg: Graphics
  private readonly icon: Text
  private readonly fillColor: number
  private readonly activeFillColor: number

  constructor(opts: { fillColor: number; activeFillColor: number }) {
    super()
    this.fillColor = opts.fillColor
    this.activeFillColor = opts.activeFillColor

    this.bg = new Graphics()
    this.addChild(this.bg)
    this.drawBg(false)

    this.icon = new Text({
      text: '⛶',
      style: {
        fill: 0xfff700,
        fontSize: LABEL_FONT_SIZE,
        fontFamily: 'Space Mono, monospace',
      },
    })
    this.icon.anchor.set(0.5)
    this.addChild(this.icon)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointerdown', this.handleDown)
    document.addEventListener('fullscreenchange', this.syncState)
    this.syncState()
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    document.removeEventListener('fullscreenchange', this.syncState)
    super.destroy(options)
  }

  private handleDown = (event: FederatedPointerEvent) => {
    event.stopPropagation()
    if (document.fullscreenElement) {
      void document.exitFullscreen?.()
    } else {
      void document.documentElement.requestFullscreen?.()
    }
  }

  private syncState = () => {
    this.drawBg(Boolean(document.fullscreenElement))
  }

  private drawBg(active: boolean): void {
    this.bg
      .clear()
      .roundRect(-BUTTON_SIZE / 2, -BUTTON_SIZE / 2, BUTTON_SIZE, BUTTON_SIZE, 4)
      .fill({ color: active ? this.activeFillColor : this.fillColor, alpha: 0.85 })
      .stroke({ width: 2, color: 0xfff700 })
  }
}
