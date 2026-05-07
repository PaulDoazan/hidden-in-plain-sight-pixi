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

  constructor(options: LayoutOptions) {
    this.worldWidth = options.worldWidth
    this.worldHeight = options.worldHeight
    this.playAreaRatio = options.worldWidth / options.worldHeight
    this.arrivalLineX = options.worldWidth - (options.arrivalLineMargin ?? 30)
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
