import { Container, Text } from 'pixi.js'
import type { LeaderboardEntry, LobbyStatePayload } from '@hips/shared'

import type { Game } from '../app/Game'
import type { Layout } from '../systems/Layout'
import { Button } from '../ui/Button'

import { GameScene } from './GameScene'
import { Scene } from './Scene'

// Small empty band, in pixels, kept around the screen midline so the result
// column (left) and the leaderboard column (right) don't touch.
const COLUMN_GUTTER = 24
// Margin kept from the screen edges.
const OUTER_MARGIN = 24
// Left-most / right-most x of the leaderboard content, relative to its
// container origin. Must match the row offsets used in buildLeaderboard.
const LEADERBOARD_LEFT_EDGE = -160
const LEADERBOARD_RIGHT_EDGE = 200

export type EndSceneParams =
  | {
      reason: 'arrival'
      won: boolean
      code: string | null
      winnerUsername: string
      leaderboard: LeaderboardEntry[]
    }
  | {
      reason: 'all-dead'
      code: string | null
      leaderboard: LeaderboardEntry[]
    }

export class EndScene extends Scene {
  private message!: Text
  private subtitle!: Text
  private elapsed = 0
  private replayBtn: Button | null = null
  private hint: Text | null = null
  private lobbyHandler: ((payload: LobbyStatePayload) => void) | null = null
  private roomCode: string | null = null
  private leaderboardContainer: Container | null = null
  private leaderboardEntries: LeaderboardEntry[] = []

  constructor(private readonly game: Game) {
    super()
  }

  // Two-column geometry. The leaderboard prefers a balanced spot just right of
  // a small central gutter, but is clamped so its right-most text never runs
  // off the screen edge (tight on mobile). The result column is then centered
  // in whatever space is left, minus the gutter.
  private columnLayout(): { leftX: number; leaderboardX: number } {
    const { canvasWidth } = this.game.layout
    const centerX = canvasWidth / 2
    const preferredX = centerX + COLUMN_GUTTER / 2 - LEADERBOARD_LEFT_EDGE
    const maxX = canvasWidth - OUTER_MARGIN - LEADERBOARD_RIGHT_EDGE
    const leaderboardX = Math.min(preferredX, maxX)
    const leftRegionRight = leaderboardX + LEADERBOARD_LEFT_EDGE - COLUMN_GUTTER
    const leftX = (OUTER_MARGIN + leftRegionRight) / 2
    return { leftX, leaderboardX }
  }

  onEnter(params?: unknown): void {
    const typed = params as EndSceneParams | undefined
    this.roomCode = typed?.code ?? null
    this.leaderboardEntries = typed?.leaderboard ?? []
    const { canvasHeight } = this.game.layout
    const { leftX } = this.columnLayout()
    const allDead = typed?.reason === 'all-dead'
    const won = typed?.reason === 'arrival' ? typed.won : false
    const winnerUsername =
      typed?.reason === 'arrival' ? typed.winnerUsername : ''
    const titleText = allDead ? 'Vous êtes tous morts !' : won ? 'Gagné' : 'Perdu'
    const titleFontSize = allDead ? 56 : 80

    this.message = new Text({
      text: titleText,
      style: { fill: 0xfff700, fontSize: titleFontSize, fontFamily: 'Space Mono, monospace' },
    })
    this.message.anchor.set(0.5)
    this.message.position.set(leftX, canvasHeight / 2 - 60)
    this.message.alpha = 0
    this.message.scale.set(0.4)
    this.addChild(this.message)

    this.subtitle = new Text({
      text: winnerUsername ? `${winnerUsername} a gagné` : '',
      style: { fill: 0xffffff, fontSize: 24, fontFamily: 'Space Mono, monospace' },
    })
    this.subtitle.anchor.set(0.5)
    this.subtitle.position.set(leftX, canvasHeight / 2 + 10)
    this.addChild(this.subtitle)

    this.buildLeaderboard()

    this.lobbyHandler = (payload) => this.onLobbyState(payload)
    this.game.net.on('lobby-state', this.lobbyHandler)
  }

  private buildLeaderboard(): void {
    if (this.leaderboardEntries.length === 0) return
    const { canvasHeight } = this.game.layout
    const { leaderboardX } = this.columnLayout()

    const container = new Container()
    container.position.set(leaderboardX, canvasHeight / 2)

    const header = new Text({
      text: 'Classement',
      style: {
        fill: 0xfff700,
        fontSize: 28,
        fontFamily: 'Space Mono, monospace',
        fontWeight: 'bold',
      },
    })
    header.anchor.set(0.5, 1)
    // Sit the header above the first row. Row layout below is row-centred
    // around y=0,1,2…, so the header at y = -firstRowY - header gap.
    const rowSpacing = 28
    const firstRowY = -(this.leaderboardEntries.length - 1) * (rowSpacing / 2)
    header.position.set(0, firstRowY - 24)
    container.addChild(header)

    // Column offsets (relative to the container's centre).
    const rankX = LEADERBOARD_LEFT_EDGE
    const nameX = -120
    const ptsX = 60
    const deltaX = 130

    this.leaderboardEntries.forEach((entry, i) => {
      const y = firstRowY + i * rowSpacing
      const rank = new Text({
        text: `${i + 1}.`,
        style: { fill: 0xffffff, fontSize: 20, fontFamily: 'Space Mono, monospace' },
      })
      rank.anchor.set(0, 0.5)
      rank.position.set(rankX, y)

      const name = new Text({
        text: entry.username,
        style: { fill: 0xffffff, fontSize: 20, fontFamily: 'Space Mono, monospace' },
      })
      name.anchor.set(0, 0.5)
      name.position.set(nameX, y)

      const pts = new Text({
        text: `${entry.total} pts`,
        style: {
          fill: 0xfff700,
          fontSize: 20,
          fontFamily: 'Space Mono, monospace',
          fontWeight: 'bold',
        },
      })
      pts.anchor.set(0, 0.5)
      pts.position.set(ptsX, y)

      const delta = new Text({
        text: `(+${entry.lastDelta})`,
        style: {
          fill: entry.lastDelta > 0 ? 0x69f0ae : 0x888888,
          fontSize: 18,
          fontFamily: 'Space Mono, monospace',
        },
      })
      delta.anchor.set(0, 0.5)
      delta.position.set(deltaX, y)

      container.addChild(rank, name, pts, delta)
    })

    this.addChild(container)
    this.leaderboardContainer = container
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
    const { canvasHeight } = this.game.layout
    const { leftX, leaderboardX } = this.columnLayout()
    this.message?.position.set(leftX, canvasHeight / 2 - 60)
    this.subtitle?.position.set(leftX, canvasHeight / 2 + 10)
    this.replayBtn?.position.set(leftX, canvasHeight / 2 + 80)
    this.hint?.position.set(leftX, canvasHeight / 2 + 80)
    if (this.leaderboardContainer) {
      this.leaderboardContainer.position.set(leaderboardX, canvasHeight / 2)
    }
  }

  private onLobbyState(payload: LobbyStatePayload): void {
    const { canvasHeight } = this.game.layout
    const { leftX } = this.columnLayout()
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)

    if (payload.status === 'waiting') {
      void this.game.sceneManager.goTo(new GameScene(this.game), {
        initialLobby: payload,
        code: this.roomCode,
      })
      return
    }

    if (this.replayBtn || this.hint) return
    if (isHost) {
      const btn = new Button({
        label: 'Rejouer',
        onClick: () => this.game.net.emit('replay'),
      })
      btn.position.set(leftX, canvasHeight / 2 + 80)
      this.addChild(btn)
      this.replayBtn = btn
    } else {
      const hint = new Text({
        text: "En attente d'une nouvelle partie…",
        style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
      })
      hint.anchor.set(0.5)
      hint.position.set(leftX, canvasHeight / 2 + 80)
      this.addChild(hint)
      this.hint = hint
    }
  }
}
