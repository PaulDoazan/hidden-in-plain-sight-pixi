import { Text } from 'pixi.js'

import type { Game } from '../app/Game'

import { Scene } from './Scene'

export class EndScene extends Scene {
  constructor(private readonly game: Game) {
    super()
  }
  onEnter(_params?: unknown): void {
    const t = new Text({
      text: 'Gagné !',
      style: { fill: 0xfff700, fontSize: 64, fontFamily: 'Space Mono, monospace' },
    })
    t.anchor.set(0.5)
    t.position.set(this.game.layout.canvasWidth / 2, this.game.layout.canvasHeight / 2)
    this.addChild(t)
  }
  onExit(): void {}
  update(): void {}
}
