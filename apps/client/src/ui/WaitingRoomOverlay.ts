import { Container, Graphics, Text } from 'pixi.js'

import { Button } from './Button'

export interface WaitingRoomOverlayOptions {
  width: number
  height: number
  playerCount: number
  isHost: boolean
  code: string | null
  onStart: () => void
}

export class WaitingRoomOverlay extends Container {
  private readonly count: Text
  private startBtn: Button | null = null
  private hostHint: Text | null = null
  private copyBtn: Button | null = null
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: WaitingRoomOverlayOptions) {
    super()

    const dim = new Graphics()
      .rect(0, 0, opts.width, opts.height)
      .fill({ color: 0x000000, alpha: 0.85 })
    this.addChild(dim)

    const title = new Text({
      text: "Salle d'attente",
      style: { fill: 0xfff700, fontSize: 36, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(opts.width / 2, opts.height / 2 - 140)
    this.addChild(title)

    if (opts.code) {
      const codeLabel = new Text({
        text: 'Code de la partie',
        style: { fill: 0xaaaaaa, fontSize: 14, fontFamily: 'Space Mono, monospace' },
      })
      codeLabel.anchor.set(0.5)
      codeLabel.position.set(opts.width / 2, opts.height / 2 - 100)
      this.addChild(codeLabel)

      const codeText = new Text({
        text: opts.code,
        style: {
          fill: 0xfff700,
          fontSize: 44,
          fontFamily: 'Space Mono, monospace',
          letterSpacing: 6,
        },
      })
      codeText.anchor.set(0.5)
      codeText.position.set(opts.width / 2, opts.height / 2 - 60)
      this.addChild(codeText)

      const copyBtn = new Button({
        label: 'Copier le code',
        width: 160,
        height: 36,
        onClick: () => void this.copyCode(opts.code as string),
      })
      copyBtn.position.set(opts.width / 2, opts.height / 2 - 15)
      this.addChild(copyBtn)
      this.copyBtn = copyBtn
    }

    this.count = new Text({
      text: this.formatCount(opts.playerCount),
      style: { fill: 0xffffff, fontSize: 22, fontFamily: 'Space Mono, monospace' },
    })
    this.count.anchor.set(0.5)
    this.count.position.set(opts.width / 2, opts.height / 2 + 30)
    this.addChild(this.count)

    if (opts.isHost) this.addStartButton()
    else this.addNonHostHint()
  }

  setPlayerCount(n: number): void {
    this.count.text = this.formatCount(n)
  }

  setHost(isHost: boolean): void {
    if (isHost && !this.startBtn) {
      this.removeNonHostHint()
      this.addStartButton()
    } else if (!isHost && this.startBtn) {
      this.startBtn.destroy({ children: true })
      this.startBtn = null
      this.addNonHostHint()
    }
  }

  private formatCount(n: number): string {
    return `${n} joueur${n > 1 ? 's' : ''} connecté${n > 1 ? 's' : ''}`
  }

  private addStartButton(): void {
    const btn = new Button({ label: 'Démarrer', onClick: this.opts.onStart })
    btn.position.set(this.opts.width / 2, this.opts.height / 2 + 90)
    this.addChild(btn)
    this.startBtn = btn
  }

  private addNonHostHint(): void {
    if (this.hostHint) return
    const hint = new Text({
      text: "En attente de l'hôte…",
      style: { fill: 0xaaaaaa, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    hint.anchor.set(0.5)
    hint.position.set(this.opts.width / 2, this.opts.height / 2 + 90)
    this.addChild(hint)
    this.hostHint = hint
  }

  private removeNonHostHint(): void {
    if (!this.hostHint) return
    this.hostHint.destroy()
    this.hostHint = null
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
    this.flashCopyLabel(ok ? 'Copié !' : 'Échec, copie-le à la main')
  }

  private flashCopyLabel(message: string): void {
    if (!this.copyBtn) return
    const btn = this.copyBtn
    btn.setLabel(message)
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer)
    this.copyResetTimer = setTimeout(() => {
      btn.setLabel('Copier le code')
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
