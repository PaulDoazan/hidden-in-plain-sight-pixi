import { Container, Graphics, Text } from 'pixi.js'

export interface ButtonOptions {
  label: string
  width?: number
  height?: number
  onClick: () => void
}

export class Button extends Container {
  constructor(options: ButtonOptions) {
    super()
    const w = options.width ?? 200
    const h = options.height ?? 60

    const bg = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 8)
      .fill({ color: 0x1f2937 })
      .stroke({ width: 2, color: 0xfff700 })

    const label = new Text({
      text: options.label,
      style: { fill: 0xfff700, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    label.anchor.set(0.5)

    this.addChild(bg, label)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', options.onClick)
  }
}
