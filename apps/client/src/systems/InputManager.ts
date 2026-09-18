export interface PointerPosition {
  x: number
  y: number
}

export class InputManager {
  private readonly keys = new Set<string>()
  pointer: PointerPosition = { x: 0, y: 0 }
  private firedThisFrame = false
  // Edge-triggered like firedThisFrame: B (or the mobile bonus button) sets
  // it, the scene's update loop consumes it exactly once.
  private bonusThisFrame = false
  // Virtual key state driven by the mobile on-screen controls. Folded into
  // isDown() so the rest of the game can stay agnostic of input source.
  private virtualSpace = false
  private virtualShift = false

  constructor(private readonly target: HTMLElement | Window = window) {
    this.target.addEventListener('keydown', this.onKeyDown as EventListener)
    this.target.addEventListener('keyup', this.onKeyUp as EventListener)
    window.addEventListener('pointermove', this.onPointerMove)
    // Listen on capture so we still see the click even if a Pixi-level
    // handler (or some other downstream listener) calls stopPropagation on
    // pointerdown. Also use pointerdown rather than mousedown — Pixi v8's
    // EventSystem can suppress the synthetic mousedown via preventDefault on
    // pointerdown, so the legacy listener never fires in-game.
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true })
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener)
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true } as EventListenerOptions)
  }

  isDown(key: string): boolean {
    if (key === ' ' && this.virtualSpace) return true
    if (key === 'Shift' && this.virtualShift) return true
    return this.keys.has(key)
  }

  consumeFire(): boolean {
    const fired = this.firedThisFrame
    this.firedThisFrame = false
    return fired
  }

  consumeBonus(): boolean {
    const used = this.bonusThisFrame
    this.bonusThisFrame = false
    return used
  }

  // Mobile controls bridge: the on-screen walk/run buttons toggle these flags
  // so isDown(' ') / isDown('Shift') stay the single source of truth for
  // movement state.
  setVirtualSpace(value: boolean): void {
    this.virtualSpace = value
  }

  setVirtualShift(value: boolean): void {
    this.virtualShift = value
  }

  triggerFire(): void {
    this.firedThisFrame = true
  }

  triggerBonus(): void {
    this.bonusThisFrame = true
  }

  // Mobile drag bridge: the touch surface in GameScene reports finger position
  // here so screen-space code (crosshair) keeps reading from a single source.
  setPointer(x: number, y: number): void {
    this.pointer = { x, y }
  }

  private onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.key)
    if (event.key === 'b' || event.key === 'B') this.bonusThisFrame = true
    if (event.key === ' ') event.preventDefault()
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key)
  }

  private onPointerMove = (event: PointerEvent) => {
    // Touch moves are driven by the scene-level drag handler, which respects
    // mobile button hit-testing. Skipping them here avoids fighting Pixi over
    // the cursor position when a finger crosses a button.
    if (event.pointerType === 'touch') return
    this.pointer = { x: event.clientX, y: event.clientY }
  }

  private onPointerDown = (event: PointerEvent) => {
    // Mobile uses a dedicated Fire button — auto-firing on any touch would
    // misfire on button presses and on the start of a crosshair drag.
    if (event.pointerType === 'touch') return
    // Left mouse, primary pen tip both map to button 0.
    if (event.button === 0) this.firedThisFrame = true
  }
}
