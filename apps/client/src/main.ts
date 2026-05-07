import { Application } from 'pixi.js'

import { Game } from './app/Game'
import { HomeScene } from './scenes/HomeScene'

async function bootstrap() {
  const app = new Application()
  await app.init({
    canvas: document.getElementById('game-canvas') as HTMLCanvasElement,
    resizeTo: window,
    background: '#111',
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
  })

  const game = new Game(app)
  await game.sceneManager.goTo(new HomeScene(game))
}

void bootstrap()
