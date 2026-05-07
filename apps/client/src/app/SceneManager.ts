import { Container } from 'pixi.js'

import type { Scene } from '../scenes/Scene'
import type { Layout } from '../systems/Layout'

export class SceneManager {
  current: Scene | null = null

  constructor(private readonly stage: Container) {}

  async goTo(scene: Scene, params?: unknown): Promise<void> {
    if (this.current) {
      this.current.onExit()
      this.stage.removeChild(this.current)
      this.current.destroy({ children: true })
    }
    this.current = scene
    this.stage.addChild(scene)
    await scene.onEnter(params)
  }

  update(delta: number): void {
    this.current?.update(delta)
  }

  resize(layout: Layout): void {
    this.current?.resize(layout)
  }
}
