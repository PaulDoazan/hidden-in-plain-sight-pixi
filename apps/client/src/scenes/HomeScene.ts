import { Graphics, Text } from 'pixi.js'

import type { Game } from '../app/Game'
import { Button } from '../ui/Button'
import { HelpOverlay } from '../ui/HelpOverlay'

import { LoadingScene } from './LoadingScene'
import { Scene } from './Scene'

export class HomeScene extends Scene {
  private overlay: HelpOverlay | null = null

  constructor(private readonly game: Game) {
    super()
  }

  async onEnter(): Promise<void> {
    const { canvasWidth, canvasHeight } = this.game.layout

    const bg = new Graphics()
      .rect(0, 0, canvasWidth, canvasHeight)
      .fill({ color: 0x1a2332 })
    this.addChild(bg)

    const title = new Text({
      text: 'Hidden in Plain Sight',
      style: { fill: 0xfff700, fontSize: 56, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(canvasWidth / 2, canvasHeight / 2 - 120)
    this.addChild(title)

    const playBtn = new Button({
      label: 'Jouer',
      onClick: () => {
        void this.game.sceneManager.goTo(new LoadingScene(this.game))
      },
    })
    playBtn.position.set(canvasWidth / 2, canvasHeight / 2)
    this.addChild(playBtn)

    const helpBtn = new Button({
      label: 'Aide',
      onClick: () => this.openHelp(),
    })
    helpBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 80)
    this.addChild(helpBtn)
  }

  onExit(): void {}

  update(_delta: number): void {}

  private openHelp(): void {
    if (this.overlay) return
    const { canvasWidth, canvasHeight } = this.game.layout
    this.overlay = new HelpOverlay(canvasWidth, canvasHeight, () => {
      this.overlay?.destroy({ children: true })
      this.overlay = null
    })
    this.addChild(this.overlay)
  }
}
