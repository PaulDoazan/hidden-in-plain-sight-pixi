import { Text } from 'pixi.js'

import type { Game } from '../app/Game'

import { Scene } from './Scene'

export class LoadingScene extends Scene {
  constructor(private readonly game: Game) {
    super()
  }
  onEnter(): void {
    const t = new Text({
      text: 'Loading…',
      style: { fill: 0xffffff, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    t.anchor.set(0.5)
    t.position.set(this.game.layout.canvasWidth / 2, this.game.layout.canvasHeight / 2)
    this.addChild(t)
  }
  onExit(): void {}
  update(): void {}
}
