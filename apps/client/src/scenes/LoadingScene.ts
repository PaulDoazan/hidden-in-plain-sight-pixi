import { Text } from 'pixi.js'

import type { Game } from '../app/Game'
import { ProgressBar } from '../ui/ProgressBar'

import { GameScene } from './GameScene'
import { Scene } from './Scene'

export class LoadingScene extends Scene {
  private bar: ProgressBar | null = null

  constructor(private readonly game: Game) {
    super()
  }

  async onEnter(params?: unknown): Promise<void> {
    const { canvasWidth, canvasHeight } = this.game.layout

    const label = new Text({
      text: 'Chargement…',
      style: { fill: 0xfff700, fontSize: 28, fontFamily: 'Space Mono, monospace' },
    })
    label.anchor.set(0.5)
    label.position.set(canvasWidth / 2, canvasHeight / 2 - 40)
    this.addChild(label)

    this.bar = new ProgressBar(420, 18)
    this.bar.position.set(canvasWidth / 2, canvasHeight / 2 + 10)
    this.addChild(this.bar)

    await this.game.assets.loadAll((p) => this.bar?.set(p))
    await this.game.sceneManager.goTo(new GameScene(this.game), params)
  }

  onExit(): void {}
  update(): void {}
}
