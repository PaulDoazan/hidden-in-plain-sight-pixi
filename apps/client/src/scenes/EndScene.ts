import { Text } from 'pixi.js'
import type { LobbyStatePayload } from '@hips/shared'

import type { Game } from '../app/Game'
import type { Layout } from '../systems/Layout'
import { Button } from '../ui/Button'

import { GameScene } from './GameScene'
import { Scene } from './Scene'

export interface EndSceneParams {
  won: boolean
  code: string | null
}

export class EndScene extends Scene {
  private message!: Text
  private elapsed = 0
  private replayBtn: Button | null = null
  private hint: Text | null = null
  private lobbyHandler: ((payload: LobbyStatePayload) => void) | null = null
  private roomCode: string | null = null

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(params?: unknown): void {
    const typed = params as EndSceneParams | undefined
    const won = typed?.won ?? true
    this.roomCode = typed?.code ?? null
    const { canvasWidth, canvasHeight } = this.game.layout

    this.message = new Text({
      text: won ? 'Gagné !' : 'Perdu',
      style: { fill: 0xfff700, fontSize: 80, fontFamily: 'Space Mono, monospace' },
    })
    this.message.anchor.set(0.5)
    this.message.position.set(canvasWidth / 2, canvasHeight / 2 - 60)
    this.message.alpha = 0
    this.message.scale.set(0.4)
    this.addChild(this.message)

    // Listen for the lobby reset that follows a successful replay.
    this.lobbyHandler = (payload) => this.onLobbyState(payload)
    this.game.net.on('lobby-state', this.lobbyHandler)
  }

  onExit(): void {
    if (this.lobbyHandler) {
      this.game.net.off('lobby-state', this.lobbyHandler)
      this.lobbyHandler = null
    }
  }

  update(delta: number): void {
    if (this.elapsed >= 30) return
    this.elapsed += delta
    const t = Math.min(this.elapsed / 30, 1)
    this.message.alpha = t
    this.message.scale.set(0.4 + t * 0.6)
  }

  override resize(_layout: Layout): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.message?.position.set(canvasWidth / 2, canvasHeight / 2 - 60)
    this.replayBtn?.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
    this.hint?.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
  }

  private onLobbyState(payload: LobbyStatePayload): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)

    if (payload.status === 'waiting') {
      // Server reset the room — back to lobby for everyone. Carry both the
      // initial lobby snapshot and the code so GameScene shows the badge
      // without racing for a fresh `lobby-state` event.
      void this.game.sceneManager.goTo(new GameScene(this.game), {
        initialLobby: payload,
        code: this.roomCode,
      })
      return
    }

    // status === 'ended': show the right control depending on host.
    if (this.replayBtn || this.hint) return
    if (isHost) {
      const btn = new Button({
        label: 'Rejouer',
        onClick: () => this.game.net.emit('replay'),
      })
      btn.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
      this.addChild(btn)
      this.replayBtn = btn
    } else {
      const hint = new Text({
        text: "En attente d'une nouvelle partie…",
        style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
      })
      hint.anchor.set(0.5)
      hint.position.set(canvasWidth / 2, canvasHeight / 2 + 60)
      this.addChild(hint)
      this.hint = hint
    }
  }
}
