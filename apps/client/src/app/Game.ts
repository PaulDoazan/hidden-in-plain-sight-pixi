import { Application, Container } from 'pixi.js'

import { ARRIVAL_LINE_MARGIN, WORLD_HEIGHT, WORLD_WIDTH } from '../config/gameConfig'
import { AssetLoader } from '../systems/AssetLoader'
import { audio, type AudioManager } from '../systems/AudioManager'
import { InputManager } from '../systems/InputManager'
import { Layout } from '../systems/Layout'
import { NetworkManager } from '../systems/NetworkManager'
import { SoundControl } from '../ui/SoundControl'

import { SceneManager } from './SceneManager'

export class Game {
  readonly pixi: Application
  readonly stage: Container
  readonly sceneManager: SceneManager
  readonly input: InputManager
  readonly assets: AssetLoader
  readonly layout: Layout
  readonly net: NetworkManager
  readonly audio: AudioManager
  private readonly soundControl: SoundControl

  private resizePending = false

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
    this.net = new NetworkManager()
    this.audio = audio

    // Mounted on the Pixi stage rather than inside `this.stage`, so it renders
    // above every scene and survives scene changes: sound settings have to stay
    // reachable from the menu, the lobby, a round and the end screen alike.
    this.soundControl = new SoundControl(this.audio)
    pixi.stage.addChild(this.soundControl)
    this.soundControl.layout(this.layout.canvasWidth, this.layout.canvasHeight)

    pixi.ticker.add((ticker) => {
      this.sceneManager.update(ticker.deltaTime)
      if (this.input.consumeMute()) this.soundControl.toggle()
    })

    // Browsers refuse to start any audio before a real user gesture, so the
    // whole audio stack (context + music) waits for the first click, tap or
    // keypress anywhere on the page.
    window.addEventListener('pointerdown', this.onFirstGesture, { capture: true })
    window.addEventListener('keydown', this.onFirstGesture)

    window.addEventListener('resize', this.onResize)
  }

  private onFirstGesture = () => {
    this.audio.unlock()
    window.removeEventListener('pointerdown', this.onFirstGesture, {
      capture: true,
    } as EventListenerOptions)
    window.removeEventListener('keydown', this.onFirstGesture)
  }

  // Browser resize events fire many times per second while dragging. Coalesce
  // them to one reflow per animation frame so we don't thrash the scene graph.
  private onResize = () => {
    if (this.resizePending) return
    this.resizePending = true
    requestAnimationFrame(() => {
      this.resizePending = false
      this.layout.recompute(window)
      this.sceneManager.resize(this.layout)
      this.soundControl.layout(this.layout.canvasWidth, this.layout.canvasHeight)
    })
  }
}
