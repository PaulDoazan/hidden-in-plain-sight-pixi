import { Container } from 'pixi.js'

import type { Layout } from '../systems/Layout'

export abstract class Scene extends Container {
  abstract onEnter(params?: unknown): void | Promise<void>
  abstract onExit(): void
  abstract update(delta: number): void

  resize(_layout: Layout): void {}
}
