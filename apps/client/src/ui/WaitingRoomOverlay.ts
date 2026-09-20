import { BONUS_IDS, BONUS_INFO, type BonusId } from '@hips/shared'
import { Container, Graphics, Text } from 'pixi.js'

import { audio } from '../systems/AudioManager'

import { Button } from './Button'
import { IconButton } from './IconButton'

export interface WaitingRoomPlayer {
  username: string
  isHost: boolean
  isMe: boolean
}

export interface WaitingRoomOverlayOptions {
  width: number
  height: number
  players: WaitingRoomPlayer[]
  isHost: boolean
  code: string | null
  enabledBonuses: BonusId[]
  onStart: () => void
  onToggleBonus: (bonusId: BonusId, enabled: boolean) => void
}

export class WaitingRoomOverlay extends Container {
  private width_: number
  private height_: number
  private players: WaitingRoomPlayer[]
  private isHost_: boolean
  private readonly code: string | null
  private enabledBonuses: BonusId[]
  private readonly onStart: () => void
  private readonly onToggleBonus: (bonusId: BonusId, enabled: boolean) => void
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null
  private copyBtn: IconButton | null = null
  private copyShowingCheck = false

  constructor(opts: WaitingRoomOverlayOptions) {
    super()
    this.width_ = opts.width
    this.height_ = opts.height
    this.players = opts.players
    this.isHost_ = opts.isHost
    this.code = opts.code
    this.enabledBonuses = opts.enabledBonuses
    this.onStart = opts.onStart
    this.onToggleBonus = opts.onToggleBonus
    this.rebuild()
  }

  setPlayers(players: WaitingRoomPlayer[]): void {
    if (samePlayers(this.players, players)) return
    this.players = players
    this.rebuild()
  }

  setEnabledBonuses(enabled: BonusId[]): void {
    if (
      enabled.length === this.enabledBonuses.length &&
      enabled.every((id, i) => id === this.enabledBonuses[i])
    ) {
      return
    }
    this.enabledBonuses = enabled
    this.rebuild()
  }

  setHost(isHost: boolean): void {
    if (isHost === this.isHost_) return
    this.isHost_ = isHost
    this.rebuild()
  }

  resize(width: number, height: number): void {
    this.width_ = width
    this.height_ = height
    this.rebuild()
  }

  private rebuild(): void {
    this.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.copyBtn = null

    const w = this.width_
    const h = this.height_

    const dim = new Graphics()
      .rect(0, 0, w, h)
      .fill({ color: 0x000000, alpha: 0.85 })
    this.addChild(dim)

    const title = new Text({
      text: "Salle d'attente",
      style: { fill: 0xfff700, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(w / 2, h / 2 - 140)
    this.addChild(title)

    if (this.code) {
      const codeLabel = new Text({
        text: 'Code de la partie',
        style: { fill: 0xaaaaaa, fontSize: 14, fontFamily: 'Space Mono, monospace' },
      })
      codeLabel.anchor.set(0.5)
      codeLabel.position.set(w / 2, h / 2 - 100)
      this.addChild(codeLabel)

      const codeText = new Text({
        text: this.code,
        style: {
          fill: 0xfff700,
          fontSize: 44,
          fontFamily: 'Space Mono, monospace',
          letterSpacing: 6,
        },
      })
      codeText.anchor.set(0.5)
      codeText.position.set(w / 2 - 24, h / 2 - 60)
      this.addChild(codeText)

      const code = this.code
      const copyBtn = new IconButton({
        size: 40,
        initialIcon: this.copyShowingCheck ? 'check' : 'copy',
        onClick: () => void this.copyCode(code),
      })
      copyBtn.position.set(w / 2 - 24 + codeText.width / 2 + 32, h / 2 - 60)
      this.addChild(copyBtn)
      this.copyBtn = copyBtn
    }

    const count = new Text({
      text: this.formatCount(this.players.length),
      style: { fill: 0xffffff, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    count.anchor.set(0.5)
    count.position.set(w / 2, h / 2 + 10)
    this.addChild(count)

    // Render the username list under the counter, host first (already sorted
    // server-side by playerOrder). Host gets a "(hôte)" suffix, the local
    // player is bolded via a brighter color so each user can spot themselves.
    const listStartY = h / 2 + 40
    const lineHeight = 22
    this.players.forEach((p, i) => {
      const suffix = p.isHost ? ' (hôte)' : ''
      const text = new Text({
        text: `${p.username}${suffix}`,
        style: {
          fill: p.isMe ? 0xfff700 : 0xcccccc,
          fontSize: 16,
          fontFamily: 'Space Mono, monospace',
        },
      })
      text.anchor.set(0.5)
      text.position.set(w / 2, listStartY + i * lineHeight)
      this.addChild(text)
    })

    // Bonus selection: the host ticks what this room plays with, everyone
    // else reads it. Two columns so eight entries stay above the fold.
    const bonusHeaderY = listStartY + this.players.length * lineHeight + 30
    const header = new Text({
      text: 'Bonus de la partie',
      style: { fill: 0xaaaaaa, fontSize: 14, fontFamily: 'Space Mono, monospace' },
    })
    header.anchor.set(0.5)
    header.position.set(w / 2, bonusHeaderY)
    this.addChild(header)

    const rowHeight = 22
    // Wide enough for the longest entry ("[x] 🎭 Changement de peau") at this
    // font size, or the left column runs into the right one.
    const columnWidth = 250
    const firstRowY = bonusHeaderY + 24
    const rows = Math.ceil(BONUS_IDS.length / 2)
    BONUS_IDS.forEach((bonusId, i) => {
      const info = BONUS_INFO[bonusId]
      const enabled = this.enabledBonuses.includes(bonusId)
      const entry = new Text({
        text: `${enabled ? '[x]' : '[ ]'} ${info.icon} ${info.name}`,
        style: {
          fill: enabled ? 0xfff700 : 0x777777,
          fontSize: 14,
          fontFamily: 'Space Mono, monospace',
        },
      })
      entry.anchor.set(0, 0.5)
      const column = i < rows ? 0 : 1
      const row = i % rows
      entry.position.set(
        w / 2 - columnWidth + column * (columnWidth + 10),
        firstRowY + row * rowHeight,
      )
      if (this.isHost_) {
        entry.eventMode = 'static'
        entry.cursor = 'pointer'
        entry.on('pointertap', () => {
          audio.play('ui-click')
          this.onToggleBonus(bonusId, !enabled)
        })
      }
      this.addChild(entry)
    })

    const actionsY = firstRowY + rows * rowHeight + 40
    if (this.isHost_) {
      const btn = new Button({ label: 'Démarrer', onClick: this.onStart })
      btn.position.set(w / 2, actionsY)
      this.addChild(btn)
    } else {
      const hint = new Text({
        text: "En attente de l'hôte…",
        style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
      })
      hint.anchor.set(0.5)
      hint.position.set(w / 2, actionsY)
      this.addChild(hint)
    }
  }

  private formatCount(n: number): string {
    return `${n} joueur${n > 1 ? 's' : ''} connecté${n > 1 ? 's' : ''}`
  }

  private async copyCode(code: string): Promise<void> {
    let ok: boolean
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
        ok = true
      } else {
        // Fallback for browsers without the async Clipboard API
        // (e.g. non-secure contexts). Uses a transient input + execCommand.
        const tmp = document.createElement('input')
        tmp.value = code
        tmp.style.position = 'fixed'
        tmp.style.opacity = '0'
        document.body.appendChild(tmp)
        tmp.select()
        ok = document.execCommand('copy')
        document.body.removeChild(tmp)
      }
    } catch {
      ok = false
    }
    if (ok) this.flashCopySuccess()
  }

  private flashCopySuccess(): void {
    if (!this.copyBtn) return
    this.copyShowingCheck = true
    this.copyBtn.setIcon('check')
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer)
    this.copyResetTimer = setTimeout(() => {
      this.copyShowingCheck = false
      this.copyBtn?.setIcon('copy')
      this.copyResetTimer = null
    }, 1500)
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.copyResetTimer) {
      clearTimeout(this.copyResetTimer)
      this.copyResetTimer = null
    }
    super.destroy(options)
  }
}

// Cheap equality check on the player list — short enough that field-by-field
// comparison beats hashing or JSON.stringify. Skips a rebuild() when nothing
// observable to the user changed.
function samePlayers(a: WaitingRoomPlayer[], b: WaitingRoomPlayer[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]!.username !== b[i]!.username ||
      a[i]!.isHost !== b[i]!.isHost ||
      a[i]!.isMe !== b[i]!.isMe
    ) {
      return false
    }
  }
  return true
}
