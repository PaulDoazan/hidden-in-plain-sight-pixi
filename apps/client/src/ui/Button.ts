import { Container, Graphics, Text } from 'pixi.js'

import { audio } from '../systems/AudioManager'
import type { SoundEvent } from '../systems/SoundBank'

export interface ButtonOptions {
  label: string
  width?: number
  height?: number
  onClick: () => void
  // Feedback sound, played before the handler runs. Defaults to the generic
  // click; pass another event for a dismissive action, or null to stay silent.
  sound?: SoundEvent | null
}

export class Button extends Container {
  private readonly labelText: Text

  constructor(options: ButtonOptions) {
    super()
    const w = options.width ?? 200
    const h = options.height ?? 60

    const bg = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 8)
      .fill({ color: 0x1f2937 })
      .stroke({ width: 2, color: 0xfff700 })

    this.labelText = new Text({
      text: options.label,
      style: { fill: 0xfff700, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    this.labelText.anchor.set(0.5)

    this.addChild(bg, this.labelText)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    // Every button in the game clicks, so the sound lives here rather than in
    // each caller's handler — one place to keep the UI audible and consistent.
    const sound = options.sound === undefined ? 'ui-click' : options.sound
    this.on('pointertap', () => {
      if (sound) audio.play(sound)
      options.onClick()
    })
  }

  setLabel(text: string): void {
    this.labelText.text = text
  }
}
