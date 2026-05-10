export interface PointerPosition {
  x: number
  y: number
}

export class InputManager {
  private readonly keys = new Set<string>()
  pointer: PointerPosition = { x: 0, y: 0 }
  private firedThisFrame = false

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
    return this.keys.has(key)
  }

  consumeFire(): boolean {
    const fired = this.firedThisFrame
    this.firedThisFrame = false
    return fired
  }

  private onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.key)
    if (event.key === ' ') event.preventDefault()
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key)
  }

  private onPointerMove = (event: PointerEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY }
  }

  private onPointerDown = (event: PointerEvent) => {
    // Left mouse, primary touch, or primary pen tip all map to button 0.
    if (event.button === 0) this.firedThisFrame = true
  }
}
