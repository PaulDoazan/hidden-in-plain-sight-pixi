import { Graphics, Text } from 'pixi.js'
import type {
  LobbyStatePayload,
  RoomCreatedPayload,
  RoomJoinFailedPayload,
  RoomJoinedPayload,
} from '@hips/shared'

import type { Game } from '../app/Game'
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
  private roomCreatedHandler: ((payload: RoomCreatedPayload) => void) | null = null
  private roomJoinedHandler: ((payload: RoomJoinedPayload) => void) | null = null
  private roomJoinFailedHandler: ((payload: RoomJoinFailedPayload) => void) | null =
    null

  constructor(private readonly game: Game) {
    super()
  }

  async onEnter(): Promise<void> {
    const { canvasWidth, canvasHeight } = this.game.layout

    const bg = new Graphics().rect(0, 0, canvasWidth, canvasHeight).fill({ color: 0x1a2332 })
    this.addChild(bg)

    const title = new Text({
      text: 'Hidden in Plain Sight',
      style: { fill: 0xfff700, fontSize: 56, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(canvasWidth / 2, canvasHeight / 2 - 160)
    this.addChild(title)

    const createBtn = new Button({
      label: 'Créer une partie',
      width: 280,
      onClick: () => this.onCreate(),
    })
    createBtn.position.set(canvasWidth / 2, canvasHeight / 2 - 30)
    this.addChild(createBtn)

    const joinBtn = new Button({
      label: 'Rejoindre une partie',
      width: 280,
      onClick: () => this.openJoinDialog(),
    })
    joinBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 50)
    this.addChild(joinBtn)

    const helpBtn = new Button({
      label: 'Aide',
      width: 280,
      onClick: () => this.openHelp(),
    })
    helpBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 130)
    this.addChild(helpBtn)

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
