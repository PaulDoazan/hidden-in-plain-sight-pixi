import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'

import type { AudioManager } from '../systems/AudioManager'
import { isMobileDevice } from '../systems/Platform'

import { IconButton } from './IconButton'

const BUTTON_SIZE = 40
const TRACK_WIDTH = 96
const TRACK_HEIGHT = 6
const KNOB_RADIUS = 7
// Gap between the slider and the mute button, and margin from the screen edge.
const GAP = 12
const MARGIN = 16
// Level restored when unmuting a slider that sits at zero.
const UNMUTE_VOLUME = 0.6
// Width kept free in the top-right corner for MobileControls' fullscreen
// button (44 px wide, 12 px from the edge) plus a gap.
const MOBILE_CORNER_RESERVE = 68

// Persistent sound widget: a mute toggle plus a volume slider, pinned to the
// top-right corner. It is mounted once by Game — above the scene container, not
// inside a scene — so it stays reachable in the menu, the lobby, a round and
// the end screen without any scene having to rebuild it.
export class SoundControl extends Container {
  private readonly audio: AudioManager
  private readonly button: IconButton
  private readonly slider: Container
  private readonly track: Graphics
  private readonly fill: Graphics
  private readonly knob: Graphics
  private readonly hint: Text
  private dragging = false

  constructor(audio: AudioManager) {
    super()
    this.audio = audio

    this.slider = new Container()
    this.track = new Graphics()
    this.fill = new Graphics()
    this.knob = new Graphics()
    this.slider.addChild(this.track, this.fill, this.knob)
    // The whole slider strip is the hit area, not just the knob: a 6 px bar is
    // unusable with a finger, so the container carries a taller invisible band.
    this.slider.eventMode = 'static'
    this.slider.cursor = 'pointer'
    this.slider.hitArea = {
      contains: (x: number, y: number) =>
        x >= -KNOB_RADIUS && x <= TRACK_WIDTH + KNOB_RADIUS && y >= -16 && y <= 16,
    }
    this.slider.on('pointerdown', this.onSliderDown)
    this.slider.on('globalpointermove', this.onSliderMove)
    this.slider.on('pointerup', this.onSliderUp)
    this.slider.on('pointerupoutside', this.onSliderUp)
    this.addChild(this.slider)

    this.button = new IconButton({
      size: BUTTON_SIZE,
      initialIcon: this.audio.muted ? 'sound-off' : 'sound-on',
      // Muting must not itself make a noise; unmuting gets the click back.
      sound: null,
      onClick: () => this.toggle(),
    })
    this.addChild(this.button)

    this.hint = new Text({
      text: 'M',
      style: { fill: 0x666666, fontSize: 11, fontFamily: 'Space Mono, monospace' },
    })
    this.hint.anchor.set(0.5, 0)
    this.addChild(this.hint)

    this.redraw()
  }

  // Called by Game on the mute keyboard shortcut, so the icon stays in sync
  // whichever way the player muted.
  toggle(): void {
    const muted = this.audio.toggleMute()
    // Unmuting after the slider was dragged all the way down would still be
    // silent, which reads as a broken button. Give it back an audible level.
    if (!muted && this.audio.volume === 0) this.audio.setVolume(UNMUTE_VOLUME)
    this.redraw()
  }

  // Top-right corner, laid out right-to-left from the screen edge. On a touch
  // device the corner itself is taken by MobileControls' fullscreen toggle, so
  // the whole widget slides left of it — including on the menu screens, where
  // that toggle isn't mounted, rather than jumping between scenes.
  layout(canvasWidth: number, _canvasHeight: number): void {
    const reserved = isMobileDevice() ? MOBILE_CORNER_RESERVE : 0
    const buttonX = canvasWidth - MARGIN - reserved - BUTTON_SIZE / 2
    this.button.position.set(buttonX, MARGIN + BUTTON_SIZE / 2)
    this.hint.position.set(buttonX, MARGIN + BUTTON_SIZE + 2)
    this.slider.position.set(
      buttonX - BUTTON_SIZE / 2 - GAP - TRACK_WIDTH,
      MARGIN + BUTTON_SIZE / 2,
    )
  }

  private applyVolumeFromSlider(volume: number): void {
    this.audio.setVolume(volume)
    // Dragging the slider up is an unambiguous "I want sound": honouring it
    // saves the player from also having to hit the mute button.
    if (volume > 0 && this.audio.muted) this.audio.setMuted(false)
    this.redraw()
  }

  private onSliderDown = (event: FederatedPointerEvent) => {
    this.dragging = true
    this.applyVolumeFromSlider(this.volumeAt(event))
  }

  private onSliderMove = (event: FederatedPointerEvent) => {
    if (!this.dragging) return
    this.applyVolumeFromSlider(this.volumeAt(event))
  }

  private onSliderUp = () => {
    this.dragging = false
  }

  private volumeAt(event: FederatedPointerEvent): number {
    const local = this.slider.toLocal(event.global)
    return Math.min(1, Math.max(0, local.x / TRACK_WIDTH))
  }

  private redraw(): void {
    // A volume dragged to zero is silence too, so it gets the crossed-out icon
    // even though the mute flag itself is off.
    const silent = this.audio.muted || this.audio.volume === 0
    this.button.setIcon(silent ? 'sound-off' : 'sound-on')
    const value = this.audio.muted ? 0 : this.audio.volume
    const color = silent ? 0x555555 : 0xfff700

    this.track
      .clear()
      .roundRect(0, -TRACK_HEIGHT / 2, TRACK_WIDTH, TRACK_HEIGHT, TRACK_HEIGHT / 2)
      .fill({ color: 0x1f2937 })
      .stroke({ width: 1, color: 0x555555 })

    this.fill.clear()
    if (value > 0) {
      this.fill
        .roundRect(0, -TRACK_HEIGHT / 2, TRACK_WIDTH * value, TRACK_HEIGHT, TRACK_HEIGHT / 2)
        .fill({ color })
    }

    this.knob
      .clear()
      .circle(TRACK_WIDTH * value, 0, KNOB_RADIUS)
      .fill({ color: 0x1f2937 })
      .stroke({ width: 2, color })
  }
}
