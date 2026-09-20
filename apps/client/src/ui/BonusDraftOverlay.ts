import type { BonusId } from '@hips/shared'
import { BONUS_INFO } from '@hips/shared'
import { Container, Graphics, Text } from 'pixi.js'

export interface BonusDraftPlayer {
  id: string
  username: string
  isMe: boolean
}

export interface BonusDraftOverlayOptions {
  width: number
  height: number
  offer: BonusId[]
  durationMs: number
  players: BonusDraftPlayer[]
  onPick: (bonusId: BonusId) => void
}

const CARD_WIDTH = 210
const CARD_HEIGHT = 250
const CARD_GAP = 24

// Full-screen bonus draft: three cards, a countdown, and the roster with a
// checkmark as each player locks their pick. Mirrors WaitingRoomOverlay's
// shape (rebuild-on-change, resize, French copy) so the two feel like one UI.
export class BonusDraftOverlay extends Container {
  private width_: number
  private height_: number
  private readonly offer: BonusId[]
  private readonly onPick: (bonusId: BonusId) => void
  private players: BonusDraftPlayer[]
  private picked = new Set<string>()
  private myPick: BonusId | null = null
  private readonly deadline: number
  // Seconds currently painted on the countdown, so tick() only rebuilds on a
  // second boundary instead of 60 times a second.
  private renderedSeconds = -1

  constructor(opts: BonusDraftOverlayOptions) {
    super()
    this.width_ = opts.width
    this.height_ = opts.height
    this.offer = opts.offer
    this.players = opts.players
    this.onPick = opts.onPick
    this.deadline = Date.now() + opts.durationMs
    this.rebuild()
  }

  setPlayers(players: BonusDraftPlayer[]): void {
    this.players = players
    this.rebuild()
  }

  setPicked(ids: string[]): void {
    this.picked = new Set(ids)
    this.rebuild()
  }

  resize(width: number, height: number): void {
    this.width_ = width
    this.height_ = height
    this.rebuild()
  }

  // Called from the scene's update loop.
  tick(): void {
    const seconds = this.secondsLeft()
    if (seconds === this.renderedSeconds) return
    this.rebuild(seconds)
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000))
  }

  private rebuild(overriddenSeconds?: number): void {
    this.removeChildren().forEach((c) => c.destroy({ children: true }))
    const seconds = overriddenSeconds ?? this.secondsLeft()
    this.renderedSeconds = seconds

    const w = this.width_
    const h = this.height_

    this.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.85 }))

    const title = new Text({
      text: this.myPick ? 'En attente des autres joueurs…' : 'Choisis ton bonus',
      style: { fill: 0xfff700, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(w / 2, h / 2 - 190)
    this.addChild(title)

    const countdown = new Text({
      text: `${this.renderedSeconds} s`,
      style: { fill: 0xffffff, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    countdown.anchor.set(0.5)
    countdown.position.set(w / 2, h / 2 - 150)
    this.addChild(countdown)

    // Build the card row with scaling for mobile: all three cards must fit on
    // narrow viewports (360–414 px) by scaling the entire row down while keeping
    // all three cards clickable and the roster below properly positioned.
    const span = this.offer.length * CARD_WIDTH + (this.offer.length - 1) * CARD_GAP
    const MARGIN = 16
    const scale = Math.min(1, (w - 2 * MARGIN) / span)

    const cardRow = new Container()
    const baseX = -span / 2 + CARD_WIDTH / 2
    this.offer.forEach((bonusId, i) => {
      const card = this.buildCard(bonusId)
      card.position.set(baseX + i * (CARD_WIDTH + CARD_GAP), 0)
      cardRow.addChild(card)
    })
    cardRow.scale.set(scale)
    cardRow.position.set(w / 2, h / 2)
    this.addChild(cardRow)

    // Roster follows the scaled card row.
    const rosterY = h / 2 + (CARD_HEIGHT / 2) * scale + 40
    this.players.forEach((p, i) => {
      const mark = this.picked.has(p.id) ? '✓' : '…'
      const text = new Text({
        text: `${p.username} ${mark}`,
        style: {
          fill: p.isMe ? 0xfff700 : 0xcccccc,
          fontSize: 16,
          fontFamily: 'Space Mono, monospace',
        },
      })
      text.anchor.set(0.5)
      text.position.set(w / 2, rosterY + i * 22)
      this.addChild(text)
    })
  }

  private buildCard(bonusId: BonusId): Container {
    const info = BONUS_INFO[bonusId]
    const card = new Container()
    // Once you have picked, the cards freeze: the chosen one stays lit, the
    // other two dim, and nothing is clickable any more.
    const chosen = this.myPick === bonusId
    const locked = this.myPick !== null
    const border = chosen || !locked ? 0xfff700 : 0x555555

    card.addChild(
      new Graphics()
        .roundRect(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 10)
        .fill({ color: 0x1f2937 })
        .stroke({ width: chosen ? 4 : 2, color: border }),
    )

    const icon = new Text({ text: info.icon, style: { fontSize: 52 } })
    icon.anchor.set(0.5)
    icon.position.set(0, -CARD_HEIGHT / 2 + 56)
    card.addChild(icon)

    const name = new Text({
      text: info.name,
      style: {
        fill: 0xfff700,
        fontSize: 20,
        fontFamily: 'Space Mono, monospace',
        fontWeight: 'bold',
        // The longest name ("Changement de peau") overruns the card at this
        // size, so wrap it on two lines rather than letting it cross the border.
        wordWrap: true,
        wordWrapWidth: CARD_WIDTH - 28,
        align: 'center',
      },
    })
    name.anchor.set(0.5)
    name.position.set(0, -CARD_HEIGHT / 2 + 110)
    card.addChild(name)

    const description = new Text({
      text: info.description,
      style: {
        fill: 0xcccccc,
        fontSize: 13,
        fontFamily: 'Space Mono, monospace',
        wordWrap: true,
        wordWrapWidth: CARD_WIDTH - 28,
        align: 'center',
      },
    })
    description.anchor.set(0.5, 0)
    description.position.set(0, -CARD_HEIGHT / 2 + 136)
    card.addChild(description)

    if (!locked) {
      card.eventMode = 'static'
      card.cursor = 'pointer'
      card.on('pointertap', () => {
        this.myPick = bonusId
        this.rebuild()
        this.onPick(bonusId)
      })
    } else {
      card.alpha = chosen ? 1 : 0.45
    }
    return card
  }
}
