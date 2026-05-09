import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { LobbyStatePayload, ZombieAnimation, ZombieType } from '@hips/shared'
import { SPAWN_BAND_WIDTH, SPAWN_BAND_X } from '@hips/shared'

import type { Game } from '../app/Game'
import {
  ARRIVAL_LINE_TOP_Y,
  CROSSHAIR_RADIUS,
  WORLD_HEIGHT,
  defaultGameConfig,
} from '../config/gameConfig'
import { ZOMBIE_SPRITES } from '../config/manifest'
import { Bot } from '../entities/Bot'
import { fire } from '../entities/Bullet'
import { Crosshair } from '../entities/Crosshair'
import { PlayerZombie } from '../entities/PlayerZombie'
import type { Zombie } from '../entities/Zombie'
import { WaitingRoomOverlay } from '../ui/WaitingRoomOverlay'

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
  private waitingOverlay: WaitingRoomOverlay | null = null
  private lastLobby: LobbyStatePayload = { players: [], status: 'waiting' }
  private lobbyHandler: ((payload: LobbyStatePayload) => void) | null = null

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.game.net.connect()
    this.lobbyHandler = (payload) => this.applyLobby(payload)
    this.game.net.on('lobby-state', this.lobbyHandler)
  }

  onExit(): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    if (this.lobbyHandler) {
      this.game.net.off('lobby-state', this.lobbyHandler)
      this.lobbyHandler = null
    }
  }

  update(_delta: number): void {
    // Sandbox path is gated by the overlay being dismissed (Task 4 wires that).
    // While the overlay is up, do nothing — entities aren't spawned yet.
    if (this.waitingOverlay) return

    this.bots.forEach((b) => b.update(_delta))
    this.playerZombie.update(_delta)

    // Depth sort by feet y so a zombie nearer the bottom of the screen always
    // overlaps zombies further up.
    for (const bot of this.bots) bot.zIndex = bot.y
    this.playerZombie.zIndex = this.playerZombie.y

    // Crosshair lives in screen space (constant visual size).
    this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)

    if (this.game.input.consumeFire() && this.bulletsRemaining > 0) {
      this.bulletsRemaining -= 1
      const allZombies: Zombie[] = [...this.bots, this.playerZombie]
      // Convert the screen-space crosshair position to gameLayer-local (world) coords
      // so collision detection happens in the same frame of reference as zombie aabbs.
      const worldOrigin = this.gameLayer.toLocal({
        x: this.crosshair.x,
        y: this.crosshair.y,
      })
      // The visual crosshair is fixed at CROSSHAIR_RADIUS px on screen — divide by
      // worldScale to get the equivalent world-space radius.
      const worldRadius = CROSSHAIR_RADIUS / this.game.layout.worldScale
      fire({
        origin: worldOrigin,
        radius: worldRadius,
        zombies: allZombies,
        // Splat is added to the gameLayer so it scales with the world.
        layer: this.gameLayer,
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

    // Position and scale the gameLayer so its world coordinates land inside the
    // play area on screen. Every entity, the arrival line, and any splat added
    // to gameLayer is expressed in world units (0..WORLD_WIDTH × 0..WORLD_HEIGHT).
    const { playArea, worldScale } = this.game.layout
    this.gameLayer.position.set(playArea.x, playArea.y)
    this.gameLayer.scale.set(worldScale)
    // Pseudo-3D depth sorting: a zombie's feet are at its anchor y, so children
    // with higher y are rendered on top. update() syncs zIndex = y each frame.
    this.gameLayer.sortableChildren = true
  }

  private buildBackground(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const bg1 = new Sprite(this.game.assets.get('bg1'))
    bg1.width = canvasWidth
    bg1.height = canvasHeight
    this.bgLayer.addChild(bg1)
  }

  private spawnBots(): void {
    const cycle = { minTick: 40, maxTick: 200, walkSpeed: defaultGameConfig.walkSpeed }
    const zScale = this.game.layout.zombieScale
    for (let i = 0; i < defaultGameConfig.numBots; i++) {
      const type = TYPES[i % TYPES.length]!
      const bot = new Bot({
        type,
        textures: this.zombieTextures(type),
        frameCounts: this.zombieFrameCounts(type),
        cycle,
      })
      // All zombies start on the same vertical starting line, slightly jittered
      // inside a 40-world-unit-wide band so they don't perfectly overlap.
      bot.x = SPAWN_BAND_X + Math.random() * SPAWN_BAND_WIDTH
      bot.y = WORLD_HEIGHT * (0.3 + Math.random() * 0.6) + 100
      bot.scale.set(zScale)
      this.gameLayer.addChild(bot)
      this.bots.push(bot)
    }
  }

  private spawnPlayer(): void {
    this.playerZombie = new PlayerZombie({
      type: 'man',
      textures: this.zombieTextures('man'),
      frameCounts: this.zombieFrameCounts('man'),
      input: this.game.input,
      walkSpeed: defaultGameConfig.walkSpeed,
      runSpeed: defaultGameConfig.runSpeed,
    })
    // Same starting band as bots — so the player isn't identifiable just by
    // their x position when multiplayer arrives in Phase 2.
    this.playerZombie.x = SPAWN_BAND_X + Math.random() * SPAWN_BAND_WIDTH
    this.playerZombie.y = WORLD_HEIGHT / 2 + 100
    this.playerZombie.scale.set(this.game.layout.zombieScale)
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
    const { arrivalLineX, canvasHeight, playArea, worldScale } = this.game.layout
    // The line extends past WORLD_HEIGHT down to the bottom of the screen
    // (through the bottom letterbox). Convert canvas bottom to gameLayer-local
    // coordinates so the dash loop can run in world units.
    const bottomWorldY = (canvasHeight - playArea.y) / worldScale
    const line = new Graphics()
    const dashHeight = 14
    const gap = 8
    let y = ARRIVAL_LINE_TOP_Y
    while (y < bottomWorldY) {
      line.moveTo(arrivalLineX, y).lineTo(arrivalLineX, Math.min(y + dashHeight, bottomWorldY))
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
    const value = Number.isFinite(this.bulletsRemaining)
      ? String(this.bulletsRemaining)
      : '∞'
    this.hud.text = `Balles : ${value}`
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

  private showWaitingOverlay(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.waitingOverlay = new WaitingRoomOverlay({
      width: canvasWidth,
      height: canvasHeight,
      playerCount: 0,
      isHost: false,
      onStart: () => {
        // Wired in Task 4 — emit('start') here.
      },
    })
    this.addChild(this.waitingOverlay)
  }

  private applyLobby(payload: LobbyStatePayload): void {
    this.lastLobby = payload
    if (!this.waitingOverlay) return
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)
    this.waitingOverlay.setPlayerCount(payload.players.length)
    this.waitingOverlay.setHost(isHost)
  }
}
