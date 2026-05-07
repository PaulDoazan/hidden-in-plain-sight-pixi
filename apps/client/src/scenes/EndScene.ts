import { Text } from 'pixi.js'

import type { Game } from '../app/Game'
import { Button } from '../ui/Button'

import { GameScene } from './GameScene'
import { Scene } from './Scene'

export interface EndSceneParams {
  won: boolean
}

export class EndScene extends Scene {
  private message!: Text
  private elapsed = 0

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(params?: unknown): void {
    const won = (params as EndSceneParams | undefined)?.won ?? true
    const { canvasWidth, canvasHeight } = this.game.layout

    this.message = new Text({
      text: won ? 'Gagné !' : 'Perdu',
      style: { fill: 0xfff700, fontSize: 80, fontFamily: 'Space Mono, monospace' },
    })
    this.message.anchor.set(0.5)
    this.message.position.set(canvasWidth / 2, canvasHeight / 2 - 60)
    this.message.alpha = 0
    this.message.scale.set(0.4)
    this.addChild(this.message)

    const replay = new Button({
      label: 'Rejouer',
      onClick: () => {
        void this.game.sceneManager.goTo(new GameScene(this.game))
      },
    })
    replay.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
    this.addChild(replay)
  }

  onExit(): void {}

  update(delta: number): void {
    if (this.elapsed >= 30) return
    this.elapsed += delta
    const t = Math.min(this.elapsed / 30, 1)
    this.message.alpha = t
    this.message.scale.set(0.4 + t * 0.6)
  }
}
