import { Graphics, Text } from 'pixi.js'
import type {
  LobbyStatePayload,
  RoomCreatedPayload,
  RoomJoinFailedPayload,
  RoomJoinedPayload,
} from '@hips/shared'
import { USERNAME_MAX_LENGTH } from '@hips/shared'

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

// localStorage key for the user's chosen pseudo. Survives across sessions and
// is autofilled on next visit. Same value used for both create and join.
const USERNAME_STORAGE_KEY = 'marche-ou-creve.username'
// Server treats this literal as "no real name chosen" and falls back to
// "Joueur N". Pre-filled in the input so an empty submission still works.
const DEFAULT_USERNAME = 'Joueur'

export class HomeScene extends Scene {
  private helpOverlay: HelpOverlay | null = null
  private joinOverlay: JoinRoomOverlay | null = null
  private bg!: Graphics
  private title!: Text
  private usernameLabel!: Text
  private usernameInput!: HTMLInputElement
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

    this.usernameLabel = new Text({
      text: 'Écris ton pseudo',
      style: { fill: 0x40c4ff, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    this.usernameLabel.anchor.set(0.5)
    this.addChild(this.usernameLabel)

    this.usernameInput = document.createElement('input')
    this.usernameInput.type = 'text'
    this.usernameInput.maxLength = USERNAME_MAX_LENGTH
    this.usernameInput.autocomplete = 'off'
    this.usernameInput.spellcheck = false
    this.usernameInput.value = this.loadStoredUsername()
    document.body.appendChild(this.usernameInput)

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

    this.game.audio.playMusic('lobby')
    this.game.net.connect()

    this.roomCreatedHandler = (payload) => this.onRoomReady(payload)
    this.roomJoinedHandler = (payload) => this.onRoomReady(payload)
    this.roomJoinFailedHandler = (payload) => {
      this.game.audio.play('ui-error')
      this.joinOverlay?.setError(payload.reason)
    }

    this.game.net.on('room-created', this.roomCreatedHandler)
    this.game.net.on('room-joined', this.roomJoinedHandler)
    this.game.net.on('room-join-failed', this.roomJoinFailedHandler)
  }

  onExit(): void {
    this.helpOverlay?.destroy({ children: true })
    this.helpOverlay = null
    this.joinOverlay?.destroy({ children: true })
    this.joinOverlay = null
    if (this.usernameInput?.parentNode) {
      this.usernameInput.parentNode.removeChild(this.usernameInput)
    }
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
    // Pseudo block (label + input) sits in its own visual zone above the
    // button stack, separated by extra vertical breathing room so users read
    // it as "fill this first" rather than as a fourth button.
    this.title.position.set(canvasWidth / 2, canvasHeight / 2 - 240)
    this.usernameLabel.position.set(canvasWidth / 2, canvasHeight / 2 - 160)
    this.createBtn.position.set(canvasWidth / 2, canvasHeight / 2 - 10)
    this.joinBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 70)
    this.helpBtn.position.set(canvasWidth / 2, canvasHeight / 2 + 150)
    this.layoutUsernameInput(canvasWidth, canvasHeight)
  }

  private layoutUsernameInput(w: number, h: number): void {
    // Sky blue instead of the yellow used for buttons/title — different
    // semantic role (text input vs action), distinct enough at a glance
    // that the user doesn't read it as another button.
    this.usernameInput.style.cssText = [
      'position: fixed',
      `left: ${w / 2 - 140}px`,
      `top: ${h / 2 - 140}px`,
      'width: 280px',
      'height: 44px',
      'font: 22px/44px "Space Mono", monospace',
      'text-align: center',
      'color: #40c4ff',
      'background: #0f1822',
      'border: 2px solid #40c4ff',
      'border-radius: 8px',
      'outline: none',
      'caret-color: #40c4ff',
      'z-index: 10',
      'pointer-events: auto',
      'user-select: text',
      '-webkit-user-select: text',
    ].join('; ')
  }

  private currentUsername(): string {
    return this.usernameInput.value
  }

  private persistUsername(value: string): void {
    try {
      const trimmed = value.trim()
      if (trimmed.length === 0) {
        window.localStorage.removeItem(USERNAME_STORAGE_KEY)
      } else {
        window.localStorage.setItem(USERNAME_STORAGE_KEY, trimmed)
      }
    } catch {
      // localStorage can throw in private-mode Safari or when disabled.
      // Persistence is best-effort — losing it just means the user retypes.
    }
  }

  private loadStoredUsername(): string {
    try {
      const stored = window.localStorage.getItem(USERNAME_STORAGE_KEY)
      if (stored && stored.length > 0) return stored
    } catch {
      // Ignored — see persistUsername.
    }
    return DEFAULT_USERNAME
  }

  private onCreate(): void {
    const username = this.currentUsername()
    this.persistUsername(username)
    this.game.net.emit('create-room', { username })
  }

  private openJoinDialog(): void {
    if (this.joinOverlay) return
    const { canvasWidth, canvasHeight } = this.game.layout
    this.joinOverlay = new JoinRoomOverlay({
      width: canvasWidth,
      height: canvasHeight,
      onSubmit: (code) => {
        const username = this.currentUsername()
        this.persistUsername(username)
        this.game.net.emit('join-room', { code, username })
      },
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
