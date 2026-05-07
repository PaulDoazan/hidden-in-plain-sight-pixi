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
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mousedown', this.onMouseDown)
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener)
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mousedown', this.onMouseDown)
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

  private onMouseMove = (event: MouseEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY }
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.button === 0) this.firedThisFrame = true
  }
}
