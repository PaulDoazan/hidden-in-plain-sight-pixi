import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { ZombieAnimation, ZombieType } from '@hips/shared'

import type { Game } from '../app/Game'
import { CROSSHAIR_RADIUS, defaultGameConfig } from '../config/gameConfig'
import { ZOMBIE_SPRITES } from '../config/manifest'
import { Bot } from '../entities/Bot'
import { fire } from '../entities/Bullet'
import { Crosshair } from '../entities/Crosshair'
import { PlayerZombie } from '../entities/PlayerZombie'
import type { Zombie } from '../entities/Zombie'

import { EndScene } from './EndScene'
import { Scene } from './Scene'

const TYPES: ZombieType[] = ['man', 'woman', 'wild']

export class GameScene extends Scene {
  private bgLayer!: Container
  private gameLayer!: Container
  private effectsLayer!: Container
  private playerZombie!: PlayerZombie
  private bots: Bot[] = []
  private crosshair!: Crosshair
  private bulletsRemaining = defaultGameConfig.bulletsPerPlayer
  private won = false
  private hud!: Text

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(): void {
    this.buildLayers()
    this.buildBackground()
    this.spawnBots()
    this.spawnPlayer()
    this.spawnCrosshair()
    this.drawArrivalLine()
    this.buildHud()
  }

  onExit(): void {}

  update(_delta: number): void {
    this.bots.forEach((b) => b.update(_delta))
    this.playerZombie.update(_delta)

    this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)

    if (this.game.input.consumeFire() && this.bulletsRemaining > 0) {
      this.bulletsRemaining -= 1
      const allZombies: Zombie[] = [...this.bots, this.playerZombie]
      fire({
        origin: { x: this.crosshair.x, y: this.crosshair.y },
        radius: CROSSHAIR_RADIUS,
        zombies: allZombies,
        layer: this.effectsLayer,
        assets: this.game.assets,
      })
      this.refreshHud()
    }

    if (!this.won && this.playerZombie.x >= this.game.layout.arrivalLineX) {
      this.won = true
      void this.game.sceneManager.goTo(new EndScene(this.game), { won: true })
    }
  }

  private buildLayers(): void {
    this.bgLayer = new Container()
    this.gameLayer = new Container()
    this.effectsLayer = new Container()
    this.addChild(this.bgLayer, this.gameLayer, this.effectsLayer)
  }

  private buildBackground(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const bg1 = new Sprite(this.game.assets.get('bg1'))
    bg1.width = canvasWidth
    bg1.height = canvasHeight
    this.bgLayer.addChild(bg1)
  }

  private spawnBots(): void {
    const { playArea } = this.game.layout
    const cycle = { minTick: 40, maxTick: 200, walkSpeed: defaultGameConfig.walkSpeed }
    for (let i = 0; i < defaultGameConfig.numBots; i++) {
      const type = TYPES[i % TYPES.length]!
      const bot = new Bot({
        type,
        textures: this.zombieTextures(type),
        frameCounts: this.zombieFrameCounts(type),
        cycle,
      })
      bot.x = playArea.x + 60 + Math.random() * (playArea.width / 2)
      bot.y = playArea.y + playArea.height * (0.3 + Math.random() * 0.6)
      this.gameLayer.addChild(bot)
      this.bots.push(bot)
    }
  }

  private spawnPlayer(): void {
    const { playArea } = this.game.layout
    this.playerZombie = new PlayerZombie({
      type: 'man',
      textures: this.zombieTextures('man'),
      frameCounts: this.zombieFrameCounts('man'),
      input: this.game.input,
      walkSpeed: defaultGameConfig.walkSpeed,
      runSpeed: defaultGameConfig.runSpeed,
    })
    this.playerZombie.x = playArea.x + 30
    this.playerZombie.y = playArea.y + playArea.height / 2
    this.gameLayer.addChild(this.playerZombie)
  }

  private spawnCrosshair(): void {
    this.crosshair = new Crosshair()
    this.crosshair.position.set(
      this.game.layout.canvasWidth / 2,
      this.game.layout.canvasHeight / 2,
    )
    this.effectsLayer.addChild(this.crosshair)
  }

  private drawArrivalLine(): void {
    const { arrivalLineX, playArea } = this.game.layout
    const line = new Graphics()
    const dashHeight = 14
    const gap = 8
    let y = playArea.y
    while (y < playArea.y + playArea.height) {
      line.moveTo(arrivalLineX, y).lineTo(arrivalLineX, Math.min(y + dashHeight, playArea.y + playArea.height))
      y += dashHeight + gap
    }
    line.stroke({ width: 3, color: 0xfff700 })
    this.gameLayer.addChild(line)
  }

  private buildHud(): void {
    this.hud = new Text({
      text: '',
      style: { fill: 0xfff700, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    this.hud.position.set(20, 20)
    this.addChild(this.hud)
    this.refreshHud()
  }

  private refreshHud(): void {
    this.hud.text = `Balles : ${this.bulletsRemaining}`
  }

  private zombieTextures(type: ZombieType): Record<ZombieAnimation, ReturnType<typeof this.game.assets.get>> {
    const animations: ZombieAnimation[] = ['walk', 'idle', 'die', 'run']
    return Object.fromEntries(
      animations.map((a) => [a, this.game.assets.get(`${type}_${a}`)]),
    ) as Record<ZombieAnimation, ReturnType<typeof this.game.assets.get>>
  }

  private zombieFrameCounts(type: ZombieType): Record<ZombieAnimation, number> {
    const animations: ZombieAnimation[] = ['walk', 'idle', 'die', 'run']
    const result = {} as Record<ZombieAnimation, number>
    for (const a of animations) {
      const meta = ZOMBIE_SPRITES.find((s) => s.alias === `${type}_${a}`)
      if (!meta) throw new Error(`No manifest entry for ${type}_${a}`)
      result[a] = meta.frameCount
    }
    return result
  }
}
