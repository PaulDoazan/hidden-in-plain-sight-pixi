import { Container, Graphics, Sprite } from 'pixi.js'
import type {
  GameStartedPayload,
  LobbyStatePayload,
  PlayerState,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'

import type { Game } from '../app/Game'
import { ARRIVAL_LINE_TOP_Y } from '../config/gameConfig'
import { ZOMBIE_SPRITES } from '../config/manifest'
import { Crosshair } from '../entities/Crosshair'
import { PlayerZombie } from '../entities/PlayerZombie'
import { WaitingRoomOverlay } from '../ui/WaitingRoomOverlay'

import { Scene } from './Scene'

export class GameScene extends Scene {
  private bgLayer!: Container
  private gameLayer!: Container
  private effectsLayer!: Container
  private crosshair!: Crosshair
  private waitingOverlay: WaitingRoomOverlay | null = null
  private lobbyHandler: ((payload: LobbyStatePayload) => void) | null = null
  private gameStarted = false
  private remoteZombies = new Map<string, PlayerZombie>()
  private arrivalLineX = 0
  private gameStartedHandler: ((payload: GameStartedPayload) => void) | null = null

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.lobbyHandler = (payload) => this.applyLobby(payload)
    this.gameStartedHandler = (payload) => this.startGame(payload)

    this.game.net.connect()
    this.game.net.on('lobby-state', this.lobbyHandler)
    this.game.net.on('game-started', this.gameStartedHandler)
  }

  onExit(): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    if (this.lobbyHandler) {
      this.game.net.off('lobby-state', this.lobbyHandler)
      this.lobbyHandler = null
    }
    if (this.gameStartedHandler) {
      this.game.net.off('game-started', this.gameStartedHandler)
      this.gameStartedHandler = null
    }
  }

  update(_delta: number): void {
    if (!this.gameStarted) return
    // Crosshair lives in screen space.
    this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)
    // Depth sort by feet y.
    for (const z of this.remoteZombies.values()) z.zIndex = z.y
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

  private showWaitingOverlay(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.waitingOverlay = new WaitingRoomOverlay({
      width: canvasWidth,
      height: canvasHeight,
      playerCount: 0,
      isHost: false,
      onStart: () => {
        this.game.net.emit('start')
      },
    })
    this.addChild(this.waitingOverlay)
  }

  private applyLobby(payload: LobbyStatePayload): void {
    if (!this.waitingOverlay) return
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)
    this.waitingOverlay.setPlayerCount(payload.players.length)
    this.waitingOverlay.setHost(isHost)
  }

  private startGame(payload: GameStartedPayload): void {
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null

    this.arrivalLineX = payload.arrivalLineX

    this.spawnCrosshair()
    this.drawArrivalLine()

    for (const state of payload.players) {
      const zombie = this.makeZombie(state)
      this.remoteZombies.set(state.id, zombie)
      this.gameLayer.addChild(zombie)
    }

    this.gameStarted = true
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
    const { canvasHeight, playArea, worldScale } = this.game.layout
    const bottomWorldY = (canvasHeight - playArea.y) / worldScale
    const line = new Graphics()
    const dashHeight = 14
    const gap = 8
    let y = ARRIVAL_LINE_TOP_Y
    while (y < bottomWorldY) {
      line.moveTo(this.arrivalLineX, y).lineTo(
        this.arrivalLineX,
        Math.min(y + dashHeight, bottomWorldY),
      )
      y += dashHeight + gap
    }
    line.stroke({ width: 3, color: 0xfff700 })
    this.gameLayer.addChild(line)
  }

  private makeZombie(state: PlayerState): PlayerZombie {
    const zombie = new PlayerZombie({
      type: state.type,
      textures: this.zombieTextures(state.type),
      frameCounts: this.zombieFrameCounts(state.type),
    })
    zombie.scale.set(this.game.layout.zombieScale)
    zombie.applyServerState(state)
    return zombie
  }

  private zombieTextures(
    type: ZombieType,
  ): Record<ZombieAnimation, ReturnType<typeof this.game.assets.get>> {
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
