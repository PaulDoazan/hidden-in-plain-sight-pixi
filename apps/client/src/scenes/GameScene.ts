import { Text } from 'pixi.js'

import type { Game } from '../app/Game'

import { Scene } from './Scene'

export class GameScene extends Scene {
  constructor(private readonly game: Game) {
    super()
  }
  onEnter(): void {
    const t = new Text({
      text: 'Game scene placeholder',
      style: { fill: 0xffffff, fontSize: 28, fontFamily: 'Space Mono, monospace' },
    })
    t.anchor.set(0.5)
    t.position.set(this.game.layout.canvasWidth / 2, this.game.layout.canvasHeight / 2)
    this.addChild(t)
  }
  onExit(): void {}
  update(): void {}
}
