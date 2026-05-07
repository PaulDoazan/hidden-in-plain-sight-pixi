import { Application, Container } from 'pixi.js'

import { ARRIVAL_LINE_MARGIN, WORLD_HEIGHT, WORLD_WIDTH } from '../config/gameConfig'
import { AssetLoader } from '../systems/AssetLoader'
import { InputManager } from '../systems/InputManager'
import { Layout } from '../systems/Layout'

import { SceneManager } from './SceneManager'

export class Game {
  readonly pixi: Application
  readonly stage: Container
  readonly sceneManager: SceneManager
  readonly input: InputManager
  readonly assets: AssetLoader
  readonly layout: Layout

  constructor(pixi: Application) {
    this.pixi = pixi
    this.stage = new Container()
    pixi.stage.addChild(this.stage)
    this.sceneManager = new SceneManager(this.stage)
    this.input = new InputManager()
    this.assets = new AssetLoader()
    this.layout = new Layout({
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      arrivalLineMargin: ARRIVAL_LINE_MARGIN,
    })
    this.layout.recompute(window)

    pixi.ticker.add((ticker) => this.sceneManager.update(ticker.deltaTime))

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    this.layout.recompute(window)
    this.sceneManager.resize(this.layout)
  }
}
