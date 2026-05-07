export interface PlayArea {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutOptions {
  playAreaRatio: number
  arrivalLineMargin?: number
}

export interface WindowSize {
  innerWidth: number
  innerHeight: number
}

export class Layout {
  canvasWidth = 0
  canvasHeight = 0
  playArea: PlayArea = { x: 0, y: 0, width: 0, height: 0 }
  arrivalLineX = 0

  private readonly ratio: number
  private readonly margin: number

  constructor(options: LayoutOptions) {
    this.ratio = options.playAreaRatio
    this.margin = options.arrivalLineMargin ?? 30
  }

  recompute(window: WindowSize): void {
    this.canvasWidth = window.innerWidth
    this.canvasHeight = window.innerHeight

    const windowRatio = this.canvasWidth / this.canvasHeight
    let width: number
    let height: number
    if (windowRatio >= this.ratio) {
      height = this.canvasHeight
      width = height * this.ratio
    } else {
      width = this.canvasWidth
      height = width / this.ratio
    }

    const x = (this.canvasWidth - width) / 2
    const y = (this.canvasHeight - height) / 2
    this.playArea = { x, y, width, height }
    this.arrivalLineX = x + width - this.margin
  }
}
