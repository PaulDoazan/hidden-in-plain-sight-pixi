import { Graphics, Text } from 'pixi.js'
import type {
  LobbyStatePayload,
  RoomCreatedPayload,
  RoomJoinFailedPayload,
  RoomJoinedPayload,
} from '@hips/shared'

import type { Game } from '../app/Game'
import type { Layout } from '../systems/Layout'
import { Button } from '../ui/Button'
import { HelpOverlay } from '../ui/HelpOverlay'
import { JoinRoomOverlay } from '../ui/JoinRoomOverlay'

import { LoadingScene } from './LoadingScene'
import { Scene } from './Scene'

export interface RoomSceneParams {
  code: string
  initialLobby: LobbyStatePayload
}

export class HomeScene extends Scene {
  private helpOverlay: HelpOverlay | null = null
  private joinOverlay: JoinRoomOverlay | null = null
  private bg!: Graphics
  private title!: Text
  private createBtn!: Button
  private joinBtn!: Button
  private helpBtn!: Button
  private roomCreatedHandler: ((payload: RoomCreatedPayload) => void) | null = null
  private roomJoinedHandler: ((payload: RoomJoinedPayload) => void) | null = null
  private roomJoinFailedHandler: ((payload: RoomJoinFailedPayload) => void) | null =
    null

  constructor(private readonly game: Game) {
    super()
  }

  async onEnter(): Promise<void> {
    this.bg = new Graphics()
    this.addChild(this.bg)

    this.title = new Text({
      text: 'Hidden in Plain Sight',
      style: { fill: 0xfff700, fontSize: 56, fontFamily: 'Space Mono, monospace' },
    })
    this.title.anchor.set(0.5)
    this.addChild(this.title)

    this.createBtn = new Button({
      label: 'Créer une partie',
      width: 280,
      onClick: () => this.onCreate(),
    })
    this.addChild(this.createBtn)

    this.joinBtn = new Button({
      label: 'Rejoindre une partie',
      width: 280,
      onClick: () => this.openJoinDialog(),
    })
    this.addChild(this.joinBtn)

    this.helpBtn = new Button({
      label: 'Aide',
      width: 280,
      onClick: () => this.openHelp(),
    })
    this.addChild(this.helpBtn)

    this.layout()

    this.game.net.connect()

    this.roomCreatedHandler = (payload) => this.onRoomReady(payload)
    this.roomJoinedHandler = (payload) => this.onRoomReady(payload)
    this.roomJoinFailedHandler = (payload) => this.joinOverlay?.setError(payload.reason)

    this.game.net.on('room-created', this.roomCreatedHandler)
    this.game.net.on('room-joined', this.roomJoinedHandler)
    this.game.net.on('room-join-failed', this.roomJoinFailedHandler)
  }

  onExit(): void {
    this.helpOverlay?.destroy({ children: true })
    this.helpOverlay = null
    this.joinOverlay?.destroy({ children: true })
    this.joinOverlay = null
    if (this.roomCreatedHandler) {
      this.game.net.off('room-created', this.roomCreatedHandler)
      this.roomCreatedHandler = null
    }
    if (this.roomJoinedHandler) {
      this.game.net.off('room-joined', this.roomJoinedHandler)
      this.roomJoinedHandler = null
    }
    if (this.roomJoinFailedHandler) {
      this.game.net.off('room-join-failed', this.roomJoinFailedHandler)
      this.roomJoinFailedHandler = null
    }
  }

  update(_delta: number): void {}

  override resize(_layout: Layout): void {
    this.layout()
    const { canvasWidth, canvasHeight } = this.game.layout
    this.joinOverlay?.resize(canvasWidth, canvasHeight)
    this.helpOverlay?.resize(canvasWidth, canvasHeight)
  }

  private layout(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.bg.clear().rect(0, 0, canvasWidth, canvasHeight).fill({ color: 0x1a2332 })
    this.title.position.set(canvasWidth / 2, canvasHeight / 2 - 160)
    this.createBtn.position.set(canvasWidth / 2, canvasHeight / 2 - 30)
    this.joinBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 50)
    this.helpBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 130)
  }

  private onCreate(): void {
    this.game.net.emit('create-room')
  }

  private openJoinDialog(): void {
    if (this.joinOverlay) return
    const { canvasWidth, canvasHeight } = this.game.layout
    this.joinOverlay = new JoinRoomOverlay({
      width: canvasWidth,
      height: canvasHeight,
      onSubmit: (code) => this.game.net.emit('join-room', { code }),
      onCancel: () => this.closeJoinDialog(),
    })
    this.addChild(this.joinOverlay)
  }

  private closeJoinDialog(): void {
    this.joinOverlay?.destroy({ children: true })
    this.joinOverlay = null
  }

  private openHelp(): void {
    if (this.helpOverlay) return
    const { canvasWidth, canvasHeight } = this.game.layout
    this.helpOverlay = new HelpOverlay(canvasWidth, canvasHeight, () => {
      this.helpOverlay?.destroy({ children: true })
      this.helpOverlay = null
    })
    this.addChild(this.helpOverlay)
  }

  private onRoomReady(payload: RoomCreatedPayload | RoomJoinedPayload): void {
    const params: RoomSceneParams = {
      code: payload.code,
      initialLobby: payload.lobby,
    }
    void this.game.sceneManager.goTo(new LoadingScene(this.game), params)
  }
}
