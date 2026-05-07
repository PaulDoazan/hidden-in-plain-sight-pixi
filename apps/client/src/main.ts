import { Application } from 'pixi.js'

async function bootstrap() {
  const app = new Application()
  await app.init({
    canvas: document.getElementById('game-canvas') as HTMLCanvasElement,
    resizeTo: window,
    background: '#222',
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
  })
  console.log('Pixi initialised', app)
}

void bootstrap()
