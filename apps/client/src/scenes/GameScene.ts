import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type {
  GameEndedPayload,
  GameStartedPayload,
  InputPayload,
  LobbyStatePayload,
  PlayerKilledPayload,
  PlayerLeftPayload,
  PlayerState,
  ShotFiredPayload,
  StatePayload,
  ZombieAnimation,
  ZombieType,
} from '@hips/shared'

import type { Game } from '../app/Game'
import { ARRIVAL_LINE_TOP_Y } from '../config/gameConfig'
import { ZOMBIE_SPRITES } from '../config/manifest'
import { BloodSplat } from '../entities/BloodSplat'
import { Crosshair } from '../entities/Crosshair'
import { FireShot } from '../entities/FireShot'
import { PlayerZombie } from '../entities/PlayerZombie'
import { WaitingRoomOverlay } from '../ui/WaitingRoomOverlay'

import { EndScene } from './EndScene'
import { Scene } from './Scene'

export class GameScene extends Scene {
  private bgLayer!: Container
  private gameLayer!: Container
  private effectsLayer!: Container
  private crosshair!: Crosshair
  private waitingOverlay: WaitingRoomOverlay | null = null
  private lobbyHandler: ((payload: LobbyStatePayload) => void) | null = null
  private gameStartedHandler: ((payload: GameStartedPayload) => void) | null = null
  private stateHandler: ((payload: StatePayload) => void) | null = null
  private shotFiredHandler: ((payload: ShotFiredPayload) => void) | null = null
  private playerKilledHandler: ((payload: PlayerKilledPayload) => void) | null = null
  private gameEndedHandler: ((payload: GameEndedPayload) => void) | null = null
  private playerLeftHandler: ((payload: PlayerLeftPayload) => void) | null = null
  private gameStarted = false
  private remoteZombies = new Map<string, PlayerZombie>()
  private arrivalLineX = 0
  private lastSentInput: InputPayload | null = null
  private worldPointer = { x: 0, y: 0 }
  private hud: Text | null = null
  private isAlive = true

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(params?: unknown): void {
    this.buildLayers()
    this.buildBackground()
    this.showWaitingOverlay()

    this.lobbyHandler = (payload) => this.applyLobby(payload)
    this.gameStartedHandler = (payload) => this.startGame(payload)
    this.stateHandler = (payload) => this.applyState(payload)
    this.shotFiredHandler = (payload) => this.onShotFired(payload)
    this.playerKilledHandler = (payload) => this.onPlayerKilled(payload)
    this.gameEndedHandler = (payload) => this.onGameEnded(payload)
    this.playerLeftHandler = (payload) => this.onPlayerLeft(payload)

    this.game.net.connect()
    this.game.net.on('lobby-state', this.lobbyHandler)
    this.game.net.on('game-started', this.gameStartedHandler)
    this.game.net.on('state', this.stateHandler)
    this.game.net.on('shot-fired', this.shotFiredHandler)
    this.game.net.on('player-killed', this.playerKilledHandler)
    this.game.net.on('game-ended', this.gameEndedHandler)
    this.game.net.on('player-left', this.playerLeftHandler)

    const initial = (params as { initialLobby?: LobbyStatePayload } | undefined)
      ?.initialLobby
    if (initial) this.applyLobby(initial)
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
    if (this.stateHandler) {
      this.game.net.off('state', this.stateHandler)
      this.stateHandler = null
    }
    if (this.shotFiredHandler) {
      this.game.net.off('shot-fired', this.shotFiredHandler)
      this.shotFiredHandler = null
    }
    if (this.playerKilledHandler) {
      this.game.net.off('player-killed', this.playerKilledHandler)
      this.playerKilledHandler = null
    }
    if (this.gameEndedHandler) {
      this.game.net.off('game-ended', this.gameEndedHandler)
      this.gameEndedHandler = null
    }
    if (this.playerLeftHandler) {
      this.game.net.off('player-left', this.playerLeftHandler)
      this.playerLeftHandler = null
    }
  }

  update(_delta: number): void {
    if (!this.gameStarted) return
    this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)
    this.worldPointer = this.gameLayer.toLocal({
      x: this.crosshair.x,
      y: this.crosshair.y,
    })

    this.maybeEmitInput()

    if (this.game.input.consumeFire() && this.isAlive) {
      console.log('[debug] firing at world', this.worldPointer)
      this.game.net.emit('fire', {
        pointer: { ...this.worldPointer },
        scale: this.game.layout.zombieScale,
      })
    }

    for (const z of this.remoteZombies.values()) z.zIndex = z.y
  }

  private onShotFired(payload: ShotFiredPayload): void {
    const fx = payload.hit ? new BloodSplat(this.game.assets) : new FireShot(this.game.assets)
    fx.position.set(payload.origin.x, payload.origin.y)
    this.gameLayer.addChild(fx)
  }

  private onPlayerKilled(payload: PlayerKilledPayload): void {
    const z = this.remoteZombies.get(payload.id)
    if (z) z.die()
    // Update local alive flag immediately rather than waiting for the next
    // state snapshot — without this, a quick double-click could squeeze a
    // fire emit between the kill event and the snapshot that flips isAlive.
    if (payload.id === this.game.net.id) this.isAlive = false
  }

  private onPlayerLeft(payload: PlayerLeftPayload): void {
    const z = this.remoteZombies.get(payload.id)
    if (!z) return
    z.destroy({ children: true })
    this.remoteZombies.delete(payload.id)
  }

  private onGameEnded(payload: GameEndedPayload): void {
    const won = payload.winnerId === this.game.net.id
    void this.game.sceneManager.goTo(new EndScene(this.game), { won })
  }

  private maybeEmitInput(): void {
    const next: InputPayload = {
      keys: {
        space: this.game.input.isDown(' '),
        shift: this.game.input.isDown('Shift'),
      },
      pointer: { x: this.worldPointer.x, y: this.worldPointer.y },
    }
    if (this.shouldSend(next)) {
      this.game.net.emit('input', next)
      this.lastSentInput = next
    }
  }

  private shouldSend(next: InputPayload): boolean {
    const last = this.lastSentInput
    if (!last) return true
    if (last.keys.space !== next.keys.space) return true
    if (last.keys.shift !== next.keys.shift) return true
    // Throttle pointer updates: emit when it has moved by more than 4 world units.
    const dx = last.pointer.x - next.pointer.x
    const dy = last.pointer.y - next.pointer.y
    return dx * dx + dy * dy > 16
  }

  private applyState(payload: StatePayload): void {
    if (!this.gameStarted) return
    const seen = new Set<string>()
    const me = this.game.net.id
    for (const state of payload.players) {
      seen.add(state.id)
      const existing = this.remoteZombies.get(state.id)
      if (existing) {
        existing.applyServerState(state)
      } else {
        const z = this.makeZombie(state)
        this.remoteZombies.set(state.id, z)
        this.gameLayer.addChild(z)
      }
      if (state.id === me) this.refreshHud(state)
    }
    // Remove entities that vanished from the snapshot (covered fully in Task 8;
    // here it's a defensive pass so late-join recovery works correctly).
    for (const [id, z] of this.remoteZombies) {
      if (!seen.has(id)) {
        z.destroy({ children: true })
        this.remoteZombies.delete(id)
      }
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
    this.buildHud()

    const me = this.game.net.id
    for (const state of payload.players) {
      const zombie = this.makeZombie(state)
      this.remoteZombies.set(state.id, zombie)
      this.gameLayer.addChild(zombie)
      if (state.id === me) this.refreshHud(state)
    }

    // Drain any stale fire flag from the click that triggered Démarrer (or
    // Replay). Without this, the first update() after gameStarted=true would
    // consume that click and immediately emit('fire').
    this.game.input.consumeFire()

    this.gameStarted = true
  }

  private buildHud(): void {
    if (this.hud) return
    this.hud = new Text({
      text: 'Balles : —',
      style: { fill: 0xfff700, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    this.hud.position.set(20, 20)
    this.addChild(this.hud)
  }

  private refreshHud(state: PlayerState): void {
    this.isAlive = state.isAlive
    if (!this.hud) return
    const alive = state.isAlive ? '' : ' (mort)'
    this.hud.text = `Balles : ${state.bulletsRemaining}${alive}`
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
