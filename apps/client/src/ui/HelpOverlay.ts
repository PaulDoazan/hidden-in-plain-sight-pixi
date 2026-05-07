import { Container, Graphics, Text } from 'pixi.js'

import { Button } from './Button'

const HELP_LINES = [
  'Souris : viser',
  'Clic gauche : tirer (1 balle)',
  'Espace : marcher',
  'Shift + Espace : courir',
  'But : franchir la ligne d\'arrivée à droite',
]

export class HelpOverlay extends Container {
  constructor(layoutWidth: number, layoutHeight: number, onClose: () => void) {
    super()

    const dim = new Graphics()
      .rect(0, 0, layoutWidth, layoutHeight)
      .fill({ color: 0x000000, alpha: 0.7 })
    this.addChild(dim)

    const title = new Text({
      text: 'Comment jouer',
      style: { fill: 0xfff700, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(layoutWidth / 2, layoutHeight / 2 - 160)
    this.addChild(title)

    HELP_LINES.forEach((line, i) => {
      const text = new Text({
        text: line,
        style: { fill: 0xffffff, fontSize: 22, fontFamily: 'Space Mono, monospace' },
      })
      text.anchor.set(0.5)
      text.position.set(layoutWidth / 2, layoutHeight / 2 - 80 + i * 36)
      this.addChild(text)
    })

    const close = new Button({ label: 'Fermer', onClick: onClose })
    close.position.set(layoutWidth / 2, layoutHeight / 2 + 160)
    this.addChild(close)
  }
}
