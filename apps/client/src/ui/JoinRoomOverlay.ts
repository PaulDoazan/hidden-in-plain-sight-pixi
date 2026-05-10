import { Container, Graphics, Text } from 'pixi.js'
import type { RoomJoinFailReason } from '@hips/shared'

import { Button } from './Button'

export interface JoinRoomOverlayOptions {
  width: number
  height: number
  onSubmit: (code: string) => void
  onCancel: () => void
}

const CODE_LENGTH = 6

// Overlay for the "Rejoindre une partie" flow. Pairs a Pixi-rendered dim+labels
// with a real HTML <input> overlaid on the canvas — Pixi v8 has no built-in
// text input and a DOM element gets keyboard handling, IME support, and
// uppercase-on-input for free.
export class JoinRoomOverlay extends Container {
  private readonly input: HTMLInputElement
  private readonly errorText: Text
  private readonly opts: JoinRoomOverlayOptions

  constructor(opts: JoinRoomOverlayOptions) {
    super()
    this.opts = opts

    const dim = new Graphics()
      .rect(0, 0, opts.width, opts.height)
      .fill({ color: 0x000000, alpha: 0.85 })
    this.addChild(dim)

    const title = new Text({
      text: 'Rejoindre une partie',
      style: { fill: 0xfff700, fontSize: 32, fontFamily: 'Space Mono, monospace' },
    })
    title.anchor.set(0.5)
    title.position.set(opts.width / 2, opts.height / 2 - 110)
    this.addChild(title)

    const label = new Text({
      text: 'Entre le code à 6 caractères',
      style: { fill: 0xffffff, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    label.anchor.set(0.5)
    label.position.set(opts.width / 2, opts.height / 2 - 60)
    this.addChild(label)

    this.input = document.createElement('input')
    this.input.type = 'text'
    this.input.maxLength = CODE_LENGTH
    this.input.autocomplete = 'off'
    this.input.spellcheck = false
    this.input.style.cssText = [
      'position: fixed',
      `left: ${opts.width / 2 - 120}px`,
      `top: ${opts.height / 2 - 25}px`,
      'width: 240px',
      'height: 50px',
      'font: 32px/50px "Space Mono", monospace',
      'letter-spacing: 6px',
      'text-align: center',
      'text-transform: uppercase',
      'color: #fff700',
      'background: #1f2937',
      'border: 2px solid #fff700',
      'border-radius: 8px',
      'outline: none',
      'caret-color: #fff700',
      'z-index: 10',
      'pointer-events: auto',
      'user-select: text',
      '-webkit-user-select: text',
    ].join('; ')
    this.input.addEventListener('keydown', this.onInputKey)
    this.input.addEventListener('input', this.onInputChange)
    document.body.appendChild(this.input)
    // Defer focus by one tick so the click that opened the overlay doesn't
    // also fire mouseup-induced blur on some browsers.
    setTimeout(() => this.input.focus(), 0)

    this.errorText = new Text({
      text: '',
      style: { fill: 0xff5555, fontSize: 16, fontFamily: 'Space Mono, monospace' },
    })
    this.errorText.anchor.set(0.5)
    this.errorText.position.set(opts.width / 2, opts.height / 2 + 30)
    this.addChild(this.errorText)

    const validate = new Button({
      label: 'Valider',
      onClick: () => this.submit(),
    })
    validate.position.set(opts.width / 2 - 110, opts.height / 2 + 90)
    this.addChild(validate)

    const cancel = new Button({
      label: 'Annuler',
      onClick: () => opts.onCancel(),
    })
    cancel.position.set(opts.width / 2 + 110, opts.height / 2 + 90)
    this.addChild(cancel)
  }

  setError(reason: RoomJoinFailReason): void {
    this.errorText.text =
      reason === 'not-found' ? 'Partie introuvable' : 'Tu es déjà dans une partie'
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.input.removeEventListener('keydown', this.onInputKey)
    this.input.removeEventListener('input', this.onInputChange)
    if (this.input.parentNode) this.input.parentNode.removeChild(this.input)
    super.destroy(options)
  }

  private submit(): void {
    const code = this.input.value.toUpperCase().trim()
    if (code.length !== CODE_LENGTH) {
      this.errorText.text = `Le code doit faire ${CODE_LENGTH} caractères`
      return
    }
    this.errorText.text = ''
    this.opts.onSubmit(code)
  }

  private onInputKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.opts.onCancel()
    }
  }

  private onInputChange = () => {
    // Force uppercase as the user types, preserving caret position.
    const before = this.input.value
    const upper = before.toUpperCase()
    if (upper !== before) {
      const pos = this.input.selectionStart ?? upper.length
      this.input.value = upper
      this.input.setSelectionRange(pos, pos)
    }
    if (this.errorText.text) this.errorText.text = ''
  }
}
