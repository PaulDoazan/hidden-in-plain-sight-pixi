export interface PlayArea {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutOptions {
  worldWidth: number
  worldHeight: number
  arrivalLineMargin?: number
  /**
   * Maximum compensation applied to per-zombie scale on smaller screens,
   * so sprites don't get unreadably small when worldScale drops far below 1.
   * Defaults to 2× — i.e. on a phone where worldScale ≈ 0.5 the zombie is
   * twice as big in gameLayer-local units, restoring the on-screen size to
   * roughly the desktop look. The race distance and walk timing are
   * unaffected because positions / speeds remain in world units.
   */
  maxZombieScale?: number
}

export interface WindowSize {
  innerWidth: number
  innerHeight: number
}

export class Layout {
  readonly worldWidth: number
  readonly worldHeight: number
  readonly playAreaRatio: number
  canvasWidth = 0
  canvasHeight = 0
  playArea: PlayArea = { x: 0, y: 0, width: 0, height: 0 }
  worldScale = 1
  // arrivalLineX is in world coordinates (constant, independent of screen size)
  readonly arrivalLineX: number

  private readonly maxZombieScale: number

  constructor(options: LayoutOptions) {
    this.worldWidth = options.worldWidth
    this.worldHeight = options.worldHeight
    this.playAreaRatio = options.worldWidth / options.worldHeight
    this.arrivalLineX = options.worldWidth - (options.arrivalLineMargin ?? 30)
    this.maxZombieScale = options.maxZombieScale ?? 2
  }

  /**
   * Per-zombie scale applied inside the (already-scaled) gameLayer so sprites
   * stay legible on small screens. Capped by `maxZombieScale`.
   * - desktop (worldScale ≈ 1): returns 1, no visual change
   * - phone (worldScale ≈ 0.5): returns 2, sprites doubled in world units
   */
  get zombieScale(): number {
    return Math.min(this.maxZombieScale, 1 / this.worldScale)
  }

  recompute(window: WindowSize): void {
    this.canvasWidth = window.innerWidth
    this.canvasHeight = window.innerHeight

    const windowRatio = this.canvasWidth / this.canvasHeight
    let width: number
    let height: number
    if (windowRatio >= this.playAreaRatio) {
      height = this.canvasHeight
      width = height * this.playAreaRatio
    } else {
      width = this.canvasWidth
      height = width / this.playAreaRatio
    }

    const x = (this.canvasWidth - width) / 2
    const y = (this.canvasHeight - height) / 2
    this.playArea = { x, y, width, height }
    this.worldScale = width / this.worldWidth
  }
}
