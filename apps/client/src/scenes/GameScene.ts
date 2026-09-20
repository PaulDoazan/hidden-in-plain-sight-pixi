import { Container, type FederatedPointerEvent, Graphics, Sprite, Text } from 'pixi.js'
import {
  BONUS_INFO,
  type BonusDraftProgressPayload,
  type BonusDraftStartedPayload,
  type BonusGrantedPayload,
  type BonusId,
  type BonusUsedPayload,
  type GameEndedPayload,
  type GameStartedPayload,
  type InputPayload,
  type LobbyStatePayload,
  type PlayerArrivedPayload,
  type PlayerKilledPayload,
  type PlayerLeftPayload,
  type PlayerState,
  type ShotFiredPayload,
  type StatePayload,
  type ZombieAnimation,
  type ZombieState,
  type ZombieType,
} from '@hips/shared'

import type { Game } from '../app/Game'
import { ARRIVAL_LINE_TOP_Y } from '../config/gameConfig'
import { ZOMBIE_BODY_BOX, ZOMBIE_SPRITES } from '../config/manifest'
import { BloodSplat } from '../entities/BloodSplat'
import { BombBlast } from '../entities/BombBlast'
import { ShieldHalo } from '../entities/ShieldHalo'
import { Crosshair } from '../entities/Crosshair'
import { FireShot } from '../entities/FireShot'
import { PlayerZombie } from '../entities/PlayerZombie'
import type { Layout } from '../systems/Layout'
import { isMobileDevice } from '../systems/Platform'
import { bonusSoundEvent, pickZombieVoice } from '../systems/SoundBank'
import { ZombieAmbience, panForWorldX } from '../systems/ZombieAmbience'
import { BonusDraftOverlay } from '../ui/BonusDraftOverlay'
import { MobileControls } from '../ui/MobileControls'
import { WaitingRoomOverlay } from '../ui/WaitingRoomOverlay'

import { EndScene } from './EndScene'
import { Scene } from './Scene'

// French ordinal for a finishing rank: 1er, then 2e, 3e, …
function ordinal(rank: number): string {
  return rank === 1 ? '1er' : `${rank}e`
}

// Max gap between two taps on the play surface for them to count as a
// double-tap (which fires on mobile).
const DOUBLE_TAP_MS = 300

// Playfield shake that follows a bomb, in milliseconds and screen pixels.
const SHAKE_DURATION_MS = 220
const SHAKE_AMPLITUDE = 8

export class GameScene extends Scene {
  private bgLayer!: Container
  private gameLayer!: Container
  private effectsLayer!: Container
  private bgSprite: Sprite | null = null
  private arrivalLine: Graphics | null = null
  private crosshair!: Crosshair
  private waitingOverlay: WaitingRoomOverlay | null = null
  private draftOverlay: BonusDraftOverlay | null = null
  private bonusDraftStartedHandler:
    | ((payload: BonusDraftStartedPayload) => void)
    | null = null
  private bonusDraftProgressHandler:
    | ((payload: BonusDraftProgressPayload) => void)
    | null = null
  private bonusGrantedHandler: ((payload: BonusGrantedPayload) => void) | null = null
  // Last known room selection, mirrored from the lobby snapshot so the
  // overlay can render the boxes without asking the server again.
  private enabledBonuses: BonusId[] = []
  // Last lobby roster, kept so the draft overlay can show who has picked.
  private lobbyPlayers: { id: string; username: string }[] = []
  // The bonus this client drafted this round, and whether its charge is gone.
  // Never comes from a snapshot: the pick is secret, so the client is the one
  // that remembers its own.
  private myBonus: BonusId | null = null
  private bonusSpent = false
  // Live bomb explosion, and how long the playfield keeps shaking for it.
  private bombBlast: BombBlast | null = null
  private shakeMsLeft = 0
  // Shield halos currently playing, each pinned to the zombie it belongs to.
  // A list rather than a single one: two Gilets can pop in the same instant.
  private shieldHalos: { halo: ShieldHalo; targetId: string }[] = []
  private lobbyHandler: ((payload: LobbyStatePayload) => void) | null = null
  private gameStartedHandler: ((payload: GameStartedPayload) => void) | null = null
  private stateHandler: ((payload: StatePayload) => void) | null = null
  private shotFiredHandler: ((payload: ShotFiredPayload) => void) | null = null
  private playerKilledHandler: ((payload: PlayerKilledPayload) => void) | null = null
  private bonusUsedHandler: ((payload: BonusUsedPayload) => void) | null = null
  private gameEndedHandler: ((payload: GameEndedPayload) => void) | null = null
  private playerLeftHandler: ((payload: PlayerLeftPayload) => void) | null = null
  private playerArrivedHandler: ((payload: PlayerArrivedPayload) => void) | null = null
  private gameStarted = false
  // True once this player crossed the line. They are safe and disarmed from
  // then on, so the scene drops into spectator mode until the round ends.
  private hasFinished = false
  private remoteZombies = new Map<string, PlayerZombie>()
  private remoteCrosshairs = new Map<string, Crosshair>()
  // Schedules the crowd's groans — see updateZombieAmbience.
  private readonly ambience = new ZombieAmbience()
  private arrivalLineX = 0
  private lastSentInput: InputPayload | null = null
  private worldPointer = { x: 0, y: 0 }
  private hud: Text | null = null
  // Last rendered "Balles : N (mort)" segment, kept so the bonus suffix can
  // be re-rendered on its own without needing the last PlayerState.
  private hudBullets = ''
  private isAlive = true
  private roomCode: string | null = null
  private touchSurface: Graphics | null = null
  private mobileControls: MobileControls | null = null
  // Window-level move/up handlers keyed by pointerId, attached at touch-down
  // so a single finger can keep dragging the crosshair even when it slides
  // over a button or off the canvas mid-drag.
  private dragHandlers = new Map<
    number,
    { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }
  >()
  // Timestamp of the last touch on the play surface. Two taps within
  // DOUBLE_TAP_MS fire (mobile has no dedicated fire button — see
  // onTouchSurfaceDown).
  private lastTapAt = 0
  // Top-screen kill-feed banners ("BANG ! A a tué B"). New banners stack
  // below older ones; each is shown opaque for 3 s then fades over the 4th
  // second. Bots dying is silent (gateway omits `username` for bot kills)
  // so they never get a banner.
  private deathBannerLayer: Container | null = null
  private deathBanners: { container: Container; addedAt: number }[] = []
  private static readonly DEATH_BANNER_DURATION_MS = 4000
  private static readonly DEATH_BANNER_FADE_MS = 1000
  // First banner is centered 130 px from the top; each following row is offset
  // by its own height + this margin, so rows never visually touch even when
  // their content widths differ.
  private static readonly DEATH_BANNER_TOP = 130
  private static readonly DEATH_BANNER_MARGIN = 12
  // "+1 balle" flash shown under the kill-feed banners when this player kills
  // another player. It can't be driven off the bullet counter: the server
  // spends and refunds the bullet inside one `fire()` call, so
  // `bulletsRemaining` looks unchanged across snapshots. The `player-killed`
  // event is the only signal.
  private bulletRewardFlash: Text | null = null
  private bulletRewardShownAt = 0
  private static readonly BULLET_FLASH_DURATION_MS = 1500
  private static readonly BULLET_FLASH_FADE_MS = 750

  constructor(private readonly game: Game) {
    super()
  }

  onEnter(params?: unknown): void {
    const typed = params as
      | { initialLobby?: LobbyStatePayload; code?: string }
      | undefined
    this.roomCode = typed?.code ?? null

    this.buildLayers()
    this.buildBackground()
    this.setupMobileUI()
    this.showWaitingOverlay()
    // This scene opens on the waiting room, and it is also where a Replay lands
    // — both are "back in the lobby", so the lobby theme comes back here.
    this.game.audio.playMusic('lobby')

    this.lobbyHandler = (payload) => this.applyLobby(payload)
    this.gameStartedHandler = (payload) => this.startGame(payload)
    this.stateHandler = (payload) => this.applyState(payload)
    this.shotFiredHandler = (payload) => this.onShotFired(payload)
    this.playerKilledHandler = (payload) => this.onPlayerKilled(payload)
    this.bonusUsedHandler = (payload) => this.onBonusUsed(payload)
    this.gameEndedHandler = (payload) => this.onGameEnded(payload)
    this.playerLeftHandler = (payload) => this.onPlayerLeft(payload)
    this.playerArrivedHandler = (payload) => this.onPlayerArrived(payload)
    this.bonusDraftStartedHandler = (payload) => this.startDraft(payload)
    this.bonusDraftProgressHandler = (payload) =>
      this.draftOverlay?.setPicked(payload.pickedIds)
    this.bonusGrantedHandler = (payload) => this.onBonusGranted(payload)

    this.game.net.connect()
    this.game.net.on('lobby-state', this.lobbyHandler)
    this.game.net.on('game-started', this.gameStartedHandler)
    this.game.net.on('state', this.stateHandler)
    this.game.net.on('shot-fired', this.shotFiredHandler)
    this.game.net.on('player-killed', this.playerKilledHandler)
    this.game.net.on('bonus-used', this.bonusUsedHandler)
    this.game.net.on('game-ended', this.gameEndedHandler)
    this.game.net.on('player-left', this.playerLeftHandler)
    this.game.net.on('player-arrived', this.playerArrivedHandler)
    this.game.net.on('bonus-draft-started', this.bonusDraftStartedHandler)
    this.game.net.on('bonus-draft-progress', this.bonusDraftProgressHandler)
    this.game.net.on('bonus-granted', this.bonusGrantedHandler)

    if (typed?.initialLobby) this.applyLobby(typed.initialLobby)
  }

  onExit(): void {
    // Nobody is running on the scoreboard: this scene owns the loop, so it is
    // the one that has to silence it when it leaves.
    this.game.audio.setRunLoop(0, 0)
    this.teardownMobileUI()
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.draftOverlay?.destroy({ children: true })
    this.draftOverlay = null
    this.deathBanners = []
    this.deathBannerLayer?.destroy({ children: true })
    this.deathBannerLayer = null
    this.bulletRewardFlash?.destroy()
    this.bulletRewardFlash = null
    this.bombBlast?.destroy({ children: true })
    this.bombBlast = null
    for (const { halo } of this.shieldHalos) halo.destroy({ children: true })
    this.shieldHalos = []
    if (this.lobbyHandler) {
      this.game.net.off('lobby-state', this.lobbyHandler)
      this.lobbyHandler = null
    }
    if (this.gameStartedHandler) {
      this.game.net.off('game-started', this.gameStartedHandler)
      this.gameStartedHandler = null
    }
    if (this.stateHandler) {
      this.game.net.off('state', this.stateHandler)
      this.stateHandler = null
    }
    if (this.shotFiredHandler) {
      this.game.net.off('shot-fired', this.shotFiredHandler)
      this.shotFiredHandler = null
    }
    if (this.playerKilledHandler) {
      this.game.net.off('player-killed', this.playerKilledHandler)
      this.playerKilledHandler = null
    }
    if (this.bonusUsedHandler) {
      this.game.net.off('bonus-used', this.bonusUsedHandler)
      this.bonusUsedHandler = null
    }
    if (this.gameEndedHandler) {
      this.game.net.off('game-ended', this.gameEndedHandler)
      this.gameEndedHandler = null
    }
    if (this.playerLeftHandler) {
      this.game.net.off('player-left', this.playerLeftHandler)
      this.playerLeftHandler = null
    }
    if (this.playerArrivedHandler) {
      this.game.net.off('player-arrived', this.playerArrivedHandler)
      this.playerArrivedHandler = null
    }
    if (this.bonusDraftStartedHandler) {
      this.game.net.off('bonus-draft-started', this.bonusDraftStartedHandler)
      this.bonusDraftStartedHandler = null
    }
    if (this.bonusDraftProgressHandler) {
      this.game.net.off('bonus-draft-progress', this.bonusDraftProgressHandler)
      this.bonusDraftProgressHandler = null
    }
    if (this.bonusGrantedHandler) {
      this.game.net.off('bonus-granted', this.bonusGrantedHandler)
      this.bonusGrantedHandler = null
    }
  }

  update(delta: number): void {
    // Banners tick on real time, independent of the gameStarted gate, so a
    // banner already on screen keeps fading even if the game just ended.
    this.updateDeathBanners()
    this.updateBulletRewardFlash()
    // Pixi's delta is in frame units (1 ≈ 16.67 ms at 60 fps); the blast is
    // timed in real milliseconds so it plays the same on any refresh rate.
    const deltaMs = (delta * 1000) / 60
    this.updateBombBlast(deltaMs)
    this.updateShieldHalos(deltaMs)
    this.draftOverlay?.tick()
    if (!this.gameStarted) return
    // Past the line the player is a spectator: the server drops their input,
    // their shots and their bonus, so the scene stops offering any of it and
    // just keeps the field animating until the round ends.
    if (!this.hasFinished) {
      this.crosshair.position.set(this.game.input.pointer.x, this.game.input.pointer.y)
      this.worldPointer = this.gameLayer.toLocal({
        x: this.crosshair.x,
        y: this.crosshair.y,
      })

      this.maybeEmitInput()

      if (this.game.input.consumeFire()) {
        this.game.net.emit('fire', {
          pointer: { ...this.worldPointer },
          scale: this.game.layout.zombieScale,
        })
      }

      if (this.game.input.consumeBonus() && this.canUseBonus()) {
        this.game.net.emit('use-bonus')
      }
    }

    for (const z of this.remoteZombies.values()) {
      z.update(delta)
      z.zIndex = z.y
    }

    this.updateZombieAmbience()
  }

  // The horde is audible: every zombie on screen groans, shuffles or growls on
  // its own timer. ZombieAmbience owns the policy that keeps a field of sixty
  // bodies a background murmur — at most one voice at a time, panned to where
  // the body stands and quieter the further it is from the player.
  private updateZombieAmbience(): void {
    const { canvasWidth, playArea, worldScale } = this.game.layout
    const me = this.game.net.id ? this.remoteZombies.get(this.game.net.id) : undefined
    const { voices, run } = this.ambience.update(
      this.remoteZombies,
      { canvasWidth, playArea, worldScale, listenerX: me?.x ?? null },
      Date.now(),
    )
    for (const voice of voices) this.game.audio.playVoice(voice.sample, voice)
    // Running is a state, not an event: the loop follows it every frame and
    // fades itself out on its own once the field stops sprinting.
    this.game.audio.setRunLoop(run.intensity, run.pan)
  }

  override resize(_layout: Layout): void {
    const { canvasWidth, canvasHeight, playArea, worldScale, zombieScale } =
      this.game.layout

    if (this.bgSprite) {
      this.bgSprite.width = canvasWidth
      this.bgSprite.height = canvasHeight
    }

    this.gameLayer?.position.set(playArea.x, playArea.y)
    this.gameLayer?.scale.set(worldScale)

    if (this.arrivalLine) this.drawArrivalLine()

    // Remote crosshairs live in world space; their inverse scale keeps their
    // on-screen size constant across viewports.
    const inv = 1 / worldScale
    for (const c of this.remoteCrosshairs.values()) c.scale.set(inv)

    // Every zombie is built with the per-viewport zombieScale; refresh them
    // so sprites stay legible after a resize.
    for (const z of this.remoteZombies.values()) z.scale.set(zombieScale)

    this.waitingOverlay?.resize(canvasWidth, canvasHeight)
    this.draftOverlay?.resize(canvasWidth, canvasHeight)
    this.repositionDeathBanners()

    if (this.touchSurface) {
      this.touchSurface
        .clear()
        .rect(0, 0, canvasWidth, canvasHeight)
        .fill({ color: 0x000000, alpha: 0 })
    }
    this.mobileControls?.resize(canvasWidth, canvasHeight)
  }

  private setupMobileUI(): void {
    if (!isMobileDevice()) return
    const { canvasWidth, canvasHeight } = this.game.layout

    // Invisible full-canvas hit area. Anything that isn't claimed by a higher
    // sibling (buttons, overlays) lands here, where the drag handler picks it
    // up. eventMode='static' is what makes the rect participate in hit tests.
    this.touchSurface = new Graphics()
      .rect(0, 0, canvasWidth, canvasHeight)
      .fill({ color: 0x000000, alpha: 0 })
    this.touchSurface.eventMode = 'static'
    this.touchSurface.on('pointerdown', this.onTouchSurfaceDown)
    // Sit right above the bg layer so gameplay layers (zombies, effects,
    // overlays, controls) render and hit-test on top of the surface.
    this.addChildAt(this.touchSurface, 1)

    this.mobileControls = new MobileControls({
      canvasWidth,
      canvasHeight,
      onWalkDown: () => this.game.input.setVirtualSpace(true),
      onWalkUp: () => this.game.input.setVirtualSpace(false),
      onRunDown: () => {
        this.game.input.setVirtualSpace(true)
        this.game.input.setVirtualShift(true)
      },
      onRunUp: () => {
        this.game.input.setVirtualSpace(false)
        this.game.input.setVirtualShift(false)
      },
      onBonus: () => this.game.input.triggerBonus(),
    })
    this.addChild(this.mobileControls)
  }

  private teardownMobileUI(): void {
    this.mobileControls?.releaseAll()
    this.mobileControls?.destroy({ children: true })
    this.mobileControls = null
    if (this.touchSurface) {
      this.touchSurface.off('pointerdown', this.onTouchSurfaceDown)
      this.touchSurface.destroy()
      this.touchSurface = null
    }
    for (const { move, up } of this.dragHandlers.values()) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    this.dragHandlers.clear()
  }

  // Touch-drag entry point: a finger lands on the canvas in a non-button area.
  // We snap the crosshair to the touchdown point and then track that finger
  // via window-level listeners — so the drag keeps working even if the finger
  // slides over a button or temporarily leaves the canvas. Each finger gets
  // its own pair of handlers, which is what enables walk + drag + fire to
  // happen on three fingers concurrently.
  private onTouchSurfaceDown = (event: FederatedPointerEvent) => {
    if (event.pointerType !== 'touch') return
    const pid = event.pointerId
    this.game.input.setPointer(event.global.x, event.global.y)

    // Double-tap fires: the crosshair was just snapped to this tap above, so a
    // quick second tap shoots wherever the finger last landed. Reset on fire so
    // a third tap starts a fresh pair rather than re-firing immediately.
    const now = Date.now()
    if (now - this.lastTapAt <= DOUBLE_TAP_MS) {
      this.game.input.triggerFire()
      this.lastTapAt = 0
    } else {
      this.lastTapAt = now
    }

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return
      this.game.input.setPointer(e.clientX, e.clientY)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      this.dragHandlers.delete(pid)
    }
    this.dragHandlers.set(pid, { move, up })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  private onShotFired(payload: ShotFiredPayload): void {
    this.game.audio.play(payload.hit ? 'shot-hit' : 'shot')
    const fx = payload.hit ? new BloodSplat(this.game.assets) : new FireShot(this.game.assets)
    fx.position.set(payload.origin.x, payload.origin.y)
    this.gameLayer.addChild(fx)
  }

  private onPlayerKilled(payload: PlayerKilledPayload): void {
    const z = this.remoteZombies.get(payload.id)
    if (z) z.die()
    // A real death groan from where the body fell, over the synthesised impact.
    this.game.audio.play(payload.id === this.game.net.id ? 'own-death' : 'death')
    this.game.audio.playVoice(pickZombieVoice('death', Math.random), {
      pan: z ? panForWorldX(z.x, this.game.layout) : 0,
      // A bomb wipes a fifth of the field in one tick — one groan per corpse
      // would be a wall of noise.
      throttleKey: 'death',
      throttleMs: 160,
    })
    // Update local alive flag immediately rather than waiting for the next
    // state snapshot — without this, a quick double-click could squeeze a
    // fire emit between the kill event and the snapshot that flips isAlive.
    if (payload.id === this.game.net.id) this.isAlive = false
    if (payload.username) {
      const text = payload.killerUsername
        ? `BANG ! ${payload.killerUsername} a tué ${payload.username}`
        : `${payload.username} est mort`
      this.addDeathBanner(text)
    }
    // killerId is only set for player-on-player kills, so a bot kill never
    // reaches here — the reward is player kills only.
    if (payload.killerId && payload.killerId === this.game.net.id) {
      this.showBulletReward()
    }
  }

  private onPlayerArrived(payload: PlayerArrivedPayload): void {
    this.game.audio.play('finish-line')
    this.addDeathBanner(
      payload.id === this.game.net.id
        ? `🏁 Tu franchis la ligne — ${ordinal(payload.rank)} (+${payload.points})`
        : `🏁 ${payload.username} franchit la ligne — ${ordinal(payload.rank)} (+${payload.points})`,
    )
    if (payload.id !== this.game.net.id) return
    this.hasFinished = true
    // Everything the player could still act with goes away at once, so the
    // screen matches what the server will now accept from them: nothing.
    this.crosshair.visible = false
    if (this.mobileControls) this.mobileControls.visible = false
    this.hudBullets = `Arrivé ${ordinal(payload.rank)} (+${payload.points})`
    this.refreshBonusHud()
  }

  // Only active, unspent bonuses have anything to trigger. The server checks
  // all of this again — this only avoids a pointless round trip.
  private canUseBonus(): boolean {
    if (!this.myBonus || this.bonusSpent) return false
    return BONUS_INFO[this.myBonus].kind === 'active'
  }

  // Authoritative: the draft overlay's onPick sets `myBonus` optimistically
  // from the card the player clicked, but the timeout path
  // (BonusDraft.resolve()) can auto-pick a *different* card for a straggler —
  // including a click that lands after the 15 s deadline. This event is the
  // server's actual grant and always wins, overwriting whatever the local
  // click set.
  private onBonusGranted(payload: BonusGrantedPayload): void {
    this.game.audio.play('bonus-granted')
    this.myBonus = payload.bonusId
    this.bonusSpent = false
    this.refreshBonusHud()
    this.mobileControls?.setBonusAvailable(this.canUseBonus())
  }

  private onBonusUsed(payload: BonusUsedPayload): void {
    // Each bonus has its own signature, so the room can tell what just went off
    // without reading the kill feed.
    this.game.audio.play(bonusSoundEvent(payload.bonusId))
    // The blast is public and comes before anything else: the bomber receives
    // this event too, and should see their own explosion.
    if (payload.killedIds?.length) this.playBombBlast(payload.killedIds)
    // Same reasoning for the halo: its owner should see their own save.
    if (payload.bonusId === 'vest') this.playShieldHalo(payload.playerId)

    if (payload.playerId === this.game.net.id) {
      this.bonusSpent = true
      this.mobileControls?.setBonusAvailable(false)
      this.refreshBonusHud()
      return
    }
    // Reaching here means the server chose to reveal it: only revealed
    // bonuses are broadcast beyond their owner.
    const info = BONUS_INFO[payload.bonusId]
    if (!info.usedMessage) return
    this.addDeathBanner(`${info.icon} ${payload.username} ${info.usedMessage}`)
  }

  private playShieldHalo(playerId: string): void {
    const zombie = this.remoteZombies.get(playerId)
    // The shot came from somewhere, so the target is on screen for everyone
    // — but a client that just joined may not have reconciled it yet.
    if (!zombie) return
    const box = ZOMBIE_BODY_BOX[zombie.type]
    const halo = new ShieldHalo(Math.max(box.width, box.height))
    this.gameLayer.addChild(halo)
    this.shieldHalos.push({ halo, targetId: playerId })
    this.positionShieldHalo(halo, playerId)
  }

  // Follows the zombie rather than freezing where the shot landed: a body
  // swap destroys and rebuilds that sprite, so the halo is re-pinned by id
  // every frame instead of holding a reference that may go stale.
  private positionShieldHalo(halo: ShieldHalo, targetId: string): void {
    const zombie = this.remoteZombies.get(targetId)
    if (!zombie) return
    const box = ZOMBIE_BODY_BOX[zombie.type]
    halo.position.set(zombie.x, zombie.y - box.height / 2)
    // The layer sorts its children by y for pseudo-3D depth; sit just in
    // front of the zombie the halo belongs to.
    halo.zIndex = zombie.y + 0.5
  }

  private updateShieldHalos(deltaMs: number): void {
    if (this.shieldHalos.length === 0) return
    this.shieldHalos = this.shieldHalos.filter(({ halo, targetId }) => {
      this.positionShieldHalo(halo, targetId)
      return halo.update(deltaMs)
    })
  }

  private playBombBlast(killedIds: string[]): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.bombBlast?.destroy({ children: true })
    this.bombBlast = new BombBlast(canvasWidth, canvasHeight)
    this.effectsLayer.addChild(this.bombBlast)
    this.shakeMsLeft = SHAKE_DURATION_MS

    // One burst per corpse, in world space so it stays pinned to the body as
    // the view scales. A bot killed off-screen simply has no zombie to sit on.
    for (const id of killedIds) {
      const zombie = this.remoteZombies.get(id)
      if (!zombie) continue
      const burst = new FireShot(this.game.assets)
      burst.position.set(zombie.x, zombie.y)
      burst.scale.set(2)
      this.gameLayer.addChild(burst)
    }
  }

  // Shakes the playfield for a moment after a detonation. The offset is
  // applied on top of the layout's own position and cleared exactly back to
  // it, so a resize during the shake cannot leave the field skewed.
  private updateBombBlast(deltaMs: number): void {
    if (this.bombBlast && !this.bombBlast.update(deltaMs)) this.bombBlast = null
    if (this.shakeMsLeft <= 0) return
    this.shakeMsLeft = Math.max(0, this.shakeMsLeft - deltaMs)
    const { playArea } = this.game.layout
    const strength = (this.shakeMsLeft / SHAKE_DURATION_MS) * SHAKE_AMPLITUDE
    this.gameLayer.position.set(
      playArea.x + (Math.random() * 2 - 1) * strength,
      playArea.y + (Math.random() * 2 - 1) * strength,
    )
  }

  private showBulletReward(): void {
    this.game.audio.play('kill-reward')
    if (!this.bulletRewardFlash) {
      this.bulletRewardFlash = new Text({
        text: '+1 balle',
        style: {
          fill: 0x4ade80,
          fontSize: 40,
          fontFamily: 'Space Mono, monospace',
          fontWeight: 'bold',
        },
      })
      this.bulletRewardFlash.anchor.set(0.5)
      this.addChild(this.bulletRewardFlash)
    }
    this.positionBulletRewardFlash()
    this.bulletRewardFlash.alpha = 1
    this.bulletRewardFlash.visible = true
    // A second kill within the window restarts the flash rather than stacking.
    this.bulletRewardShownAt = Date.now()
  }

  // Sits centered just below the kill-feed banner stack, so the reward reads
  // as a follow-up to "BANG ! ... a tué ...". repositionDeathBanners() calls
  // this too, which keeps the flash glued to the stack as banners expire or
  // the viewport resizes.
  private positionBulletRewardFlash(): void {
    const flash = this.bulletRewardFlash
    if (!flash) return
    flash.position.set(this.game.layout.canvasWidth / 2, this.deathBannerStackBottom())
  }

  private updateBulletRewardFlash(): void {
    const flash = this.bulletRewardFlash
    if (!flash || !flash.visible) return
    const age = Date.now() - this.bulletRewardShownAt
    if (age >= GameScene.BULLET_FLASH_DURATION_MS) {
      flash.visible = false
      return
    }
    const fadeStart = GameScene.BULLET_FLASH_DURATION_MS - GameScene.BULLET_FLASH_FADE_MS
    flash.alpha =
      age < fadeStart
        ? 1
        : (GameScene.BULLET_FLASH_DURATION_MS - age) / GameScene.BULLET_FLASH_FADE_MS
  }

  private addDeathBanner(message: string): void {
    if (!this.deathBannerLayer) {
      this.deathBannerLayer = new Container()
      // Sit above everything else (zombies, effects, mobile controls) so the
      // banner is never visually covered.
      this.addChild(this.deathBannerLayer)
    }
    const container = new Container()
    const text = new Text({
      text: message,
      style: {
        fill: 0xfff700,
        fontSize: 28,
        fontFamily: 'Space Mono, monospace',
        fontWeight: 'bold',
      },
    })
    text.anchor.set(0.5)
    // Dark background with yellow border, sized from the measured text plus
    // padding. Matches the game UI convention (Button, ProgressBar, etc.).
    const padX = 24
    const padY = 12
    const bgW = text.width + padX * 2
    const bgH = text.height + padY * 2
    const bg = new Graphics()
      .roundRect(-bgW / 2, -bgH / 2, bgW, bgH, 10)
      .fill({ color: 0x1f2937 })
      .stroke({ width: 2, color: 0xfff700 })
    container.addChild(bg, text)
    this.deathBannerLayer.addChild(container)
    this.deathBanners.push({ container, addedAt: Date.now() })
    this.repositionDeathBanners()
  }

  private updateDeathBanners(): void {
    if (this.deathBanners.length === 0) return
    const now = Date.now()
    let expiredCount = 0
    for (const banner of this.deathBanners) {
      const age = now - banner.addedAt
      if (age >= GameScene.DEATH_BANNER_DURATION_MS) {
        banner.container.destroy({ children: true })
        expiredCount += 1
        continue
      }
      const fadeStart = GameScene.DEATH_BANNER_DURATION_MS - GameScene.DEATH_BANNER_FADE_MS
      banner.container.alpha =
        age < fadeStart
          ? 1
          : (GameScene.DEATH_BANNER_DURATION_MS - age) / GameScene.DEATH_BANNER_FADE_MS
    }
    if (expiredCount > 0) {
      this.deathBanners.splice(0, expiredCount)
      this.repositionDeathBanners()
    }
  }

  private repositionDeathBanners(): void {
    const cx = this.game.layout.canvasWidth / 2
    let y = GameScene.DEATH_BANNER_TOP
    this.deathBanners.forEach((banner) => {
      banner.container.position.set(cx, y)
      y += banner.container.height + GameScene.DEATH_BANNER_MARGIN
    })
    this.positionBulletRewardFlash()
  }

  // Y of the next free slot under the banner stack — where the "+1 balle"
  // flash goes. Banners are centered on their position, so a slot is the
  // center of the row that would come next.
  private deathBannerStackBottom(): number {
    let y = GameScene.DEATH_BANNER_TOP
    for (const banner of this.deathBanners) {
      y += banner.container.height + GameScene.DEATH_BANNER_MARGIN
    }
    return y
  }

  private onPlayerLeft(payload: PlayerLeftPayload): void {
    const z = this.remoteZombies.get(payload.id)
    if (z) {
      z.destroy({ children: true })
      this.remoteZombies.delete(payload.id)
    }
    const c = this.remoteCrosshairs.get(payload.id)
    if (c) {
      c.destroy({ children: true })
      this.remoteCrosshairs.delete(payload.id)
    }
  }

  private onGameEnded(payload: GameEndedPayload): void {
    if (payload.reason === 'all-dead') {
      void this.game.sceneManager.goTo(new EndScene(this.game), {
        reason: 'all-dead',
        code: this.roomCode,
        leaderboard: payload.leaderboard ?? [],
      })
      return
    }
    const won = payload.winnerId === this.game.net.id
    void this.game.sceneManager.goTo(new EndScene(this.game), {
      reason: 'arrival',
      won,
      code: this.roomCode,
      winnerUsername: payload.winnerUsername ?? '',
      leaderboard: payload.leaderboard ?? [],
    })
  }

  private maybeEmitInput(): void {
    const next: InputPayload = {
      keys: {
        space: this.game.input.isDown(' '),
        shift: this.game.input.isDown('Shift'),
      },
      pointer: { x: this.worldPointer.x, y: this.worldPointer.y },
    }
    if (this.shouldSend(next)) {
      this.game.net.emit('input', next)
      this.lastSentInput = next
    }
  }

  private shouldSend(next: InputPayload): boolean {
    const last = this.lastSentInput
    if (!last) return true
    if (last.keys.space !== next.keys.space) return true
    if (last.keys.shift !== next.keys.shift) return true
    // Throttle pointer updates: emit when it has moved by more than 4 world units.
    const dx = last.pointer.x - next.pointer.x
    const dy = last.pointer.y - next.pointer.y
    return dx * dx + dy * dy > 16
  }

  private applyState(payload: StatePayload): void {
    if (!this.gameStarted) return
    const seen = new Set<string>()
    const me = this.game.net.id
    for (const state of payload.players) {
      seen.add(state.id)
      this.reconcileZombie(state)
      if (state.id === me) {
        this.refreshHud(state)
        // Sync the local crosshair color with the server-assigned palette.
        this.crosshair.setColor(state.color)
      } else {
        this.syncRemoteCrosshair(state)
      }
    }
    for (const bot of payload.bots) {
      seen.add(bot.id)
      this.reconcileZombie(bot)
    }
    // Remove entities that vanished from the snapshot (covered fully in Task 8;
    // here it's a defensive pass so late-join recovery works correctly).
    for (const [id, z] of this.remoteZombies) {
      if (!seen.has(id)) {
        z.destroy({ children: true })
        this.remoteZombies.delete(id)
      }
    }
    for (const [id, c] of this.remoteCrosshairs) {
      if (!seen.has(id)) {
        c.destroy({ children: true })
        this.remoteCrosshairs.delete(id)
      }
    }
  }

  private reconcileZombie(state: ZombieState): void {
    let existing = this.remoteZombies.get(state.id)
    // Both body-swap bonuses change a zombie's appearance mid-round, and the
    // sprite sheets are bound at construction — so a type change means a
    // rebuild, not an update.
    if (existing && existing.type !== state.type) {
      existing.destroy({ children: true })
      this.remoteZombies.delete(state.id)
      existing = undefined
    }
    if (existing) {
      existing.applyServerState(state)
    } else {
      const z = this.makeZombie(state)
      this.remoteZombies.set(state.id, z)
      this.gameLayer.addChild(z)
    }
  }

  private syncRemoteCrosshair(state: PlayerState): void {
    // A finisher no longer aims: their last pointer position would otherwise
    // sit frozen on the field for the rest of the round.
    if (state.hasFinished) {
      this.remoteCrosshairs.get(state.id)?.destroy({ children: true })
      this.remoteCrosshairs.delete(state.id)
      return
    }
    let crosshair = this.remoteCrosshairs.get(state.id)
    if (!crosshair) {
      crosshair = new Crosshair(state.color)
      // Remote crosshairs live in world space so their position matches what
      // the shooter sees on their own screen. Scale them inversely to the
      // gameLayer's scale so they stay the same on-screen size as the local
      // (screen-space) crosshair regardless of viewport.
      const inv = 1 / this.game.layout.worldScale
      crosshair.scale.set(inv)
      // A bit of transparency so remote crosshairs don't visually compete
      // with the local one for the shooter's attention.
      crosshair.alpha = 0.7
      this.gameLayer.addChild(crosshair)
      this.remoteCrosshairs.set(state.id, crosshair)
    }
    crosshair.setColor(state.color)
    crosshair.position.set(state.pointer.x, state.pointer.y)
    // Hide remote crosshairs for players that have already used their bullet
    // — a spent shooter has no reason to keep visually aiming.
    crosshair.visible = state.bulletsRemaining > 0
  }

  private buildLayers(): void {
    this.bgLayer = new Container()
    this.gameLayer = new Container()
    this.effectsLayer = new Container()
    this.addChild(this.bgLayer, this.gameLayer, this.effectsLayer)

    // Position and scale the gameLayer so its world coordinates land inside the
    // play area on screen. Every entity, the arrival line, and any splat added
    // to gameLayer is expressed in world units (0..WORLD_WIDTH × 0..WORLD_HEIGHT).
    const { playArea, worldScale } = this.game.layout
    this.gameLayer.position.set(playArea.x, playArea.y)
    this.gameLayer.scale.set(worldScale)
    // Pseudo-3D depth sorting: a zombie's feet are at its anchor y, so children
    // with higher y are rendered on top. update() syncs zIndex = y each frame.
    this.gameLayer.sortableChildren = true
  }

  private buildBackground(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    const bg1 = new Sprite(this.game.assets.get('bg1'))
    bg1.width = canvasWidth
    bg1.height = canvasHeight
    this.bgLayer.addChild(bg1)
    this.bgSprite = bg1
  }

  private showWaitingOverlay(): void {
    const { canvasWidth, canvasHeight } = this.game.layout
    this.waitingOverlay = new WaitingRoomOverlay({
      width: canvasWidth,
      height: canvasHeight,
      players: [],
      isHost: false,
      code: this.roomCode,
      enabledBonuses: this.enabledBonuses,
      onStart: () => {
        this.game.net.emit('start')
      },
      // The server is authoritative and re-broadcasts the lobby, so a box
      // only ticks once the room has actually accepted the change.
      onToggleBonus: (bonusId, enabled) => {
        this.game.net.emit('set-bonus', { bonusId, enabled })
      },
    })
    this.addChild(this.waitingOverlay)
  }

  private applyLobby(payload: LobbyStatePayload): void {
    this.enabledBonuses = payload.enabledBonuses
    this.waitingOverlay?.setEnabledBonuses(payload.enabledBonuses)
    this.lobbyPlayers = payload.players.map((p) => ({
      id: p.id,
      username: p.username,
    }))
    this.draftOverlay?.setPlayers(this.draftPlayers())
    if (!this.waitingOverlay) return
    const me = this.game.net.id
    const isHost = payload.players.some((p) => p.id === me && p.isHost)
    this.waitingOverlay.setPlayers(
      payload.players.map((p) => ({
        username: p.username,
        isHost: p.isHost,
        isMe: p.id === me,
      })),
    )
    this.waitingOverlay.setHost(isHost)
  }

  private startDraft(payload: BonusDraftStartedPayload): void {
    this.game.audio.play('draft-start')
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.myBonus = null
    this.bonusSpent = false

    const { canvasWidth, canvasHeight } = this.game.layout
    this.draftOverlay = new BonusDraftOverlay({
      width: canvasWidth,
      height: canvasHeight,
      offer: payload.offer,
      durationMs: payload.durationMs,
      players: this.draftPlayers(),
      onPick: (bonusId) => {
        this.game.audio.play('card-pick')
        this.myBonus = bonusId
        this.game.net.emit('pick-bonus', { bonusId })
      },
    })
    this.addChild(this.draftOverlay)
  }

  private draftPlayers(): { id: string; username: string; isMe: boolean }[] {
    const me = this.game.net.id
    return this.lobbyPlayers.map((p) => ({ ...p, isMe: p.id === me }))
  }

  private startGame(payload: GameStartedPayload): void {
    // A socket that joined mid-draft has no PlayerState in this round's
    // payload — the draft was already built from the pre-join roster, so
    // resolveDraft() never spawned it. Ignore the event and stay on the
    // waiting overlay; the next round's game-started will include us once we
    // get an offer of our own.
    const me = this.game.net.id
    if (!payload.players.some((p) => p.id === me)) return

    this.game.audio.play('game-start')
    // The round's theme takes over from here and is deliberately never stopped
    // by this scene: it has to keep running under the scoreboard.
    this.game.audio.playMusic('round')
    this.waitingOverlay?.destroy({ children: true })
    this.waitingOverlay = null
    this.draftOverlay?.destroy({ children: true })
    this.draftOverlay = null

    this.arrivalLineX = payload.arrivalLineX
    this.hasFinished = false
    if (this.mobileControls) this.mobileControls.visible = true
    // Bodies are re-drawn every round, so the previous round's groan timers
    // belong to ids that no longer exist.
    this.ambience.reset()

    this.spawnCrosshair()
    this.drawArrivalLine()
    this.buildHud()

    for (const state of payload.players) {
      this.reconcileZombie(state)
      if (state.id === me) this.refreshHud(state)
    }
    for (const bot of payload.bots) {
      this.reconcileZombie(bot)
    }

    // Drain any stale fire flag from the click that triggered Démarrer (or
    // Replay). Without this, the first update() after gameStarted=true would
    // consume that click and immediately emit('fire').
    this.game.input.consumeFire()
    // Same reasoning for the bonus flag: a B pressed while the draft overlay
    // was up would otherwise fire use-bonus on the round's first frame.
    this.game.input.consumeBonus()

    this.mobileControls?.setBonusAvailable(this.canUseBonus())

    this.gameStarted = true
  }

  private buildHud(): void {
    if (this.hud) return
    this.hud = new Text({
      text: 'Balles : —',
      style: { fill: 0xfff700, fontSize: 18, fontFamily: 'Space Mono, monospace' },
    })
    this.hud.position.set(20, 20)
    this.addChild(this.hud)
  }

  private refreshHud(state: PlayerState): void {
    this.isAlive = state.isAlive
    // A finisher's HUD is owned by onPlayerArrived — snapshots keep arriving
    // for the few ticks they spend walking off-screen and would overwrite it
    // with a bullet count that no longer means anything.
    if (state.hasFinished) return
    const alive = state.isAlive ? '' : ' (mort)'
    this.hudBullets = `Balles : ${state.bulletsRemaining}${alive}`
    this.refreshBonusHud()
  }

  private refreshBonusHud(): void {
    if (!this.hud) return
    // Same reason the crosshair goes: advertising "[B]" to a finisher would
    // promise a key that the server now ignores.
    if (!this.myBonus || this.hasFinished) {
      this.hud.text = this.hudBullets
      return
    }
    const info = BONUS_INFO[this.myBonus]
    const state = this.bonusSpent ? ' (utilisé)' : info.kind === 'active' ? ' [B]' : ''
    this.hud.text = `${this.hudBullets}  ·  ${info.icon} ${info.name}${state}`
  }

  private spawnCrosshair(): void {
    this.crosshair = new Crosshair()
    this.crosshair.position.set(
      this.game.layout.canvasWidth / 2,
      this.game.layout.canvasHeight / 2,
    )
    this.effectsLayer.addChild(this.crosshair)
  }

  private drawArrivalLine(): void {
    if (!this.arrivalLine) {
      this.arrivalLine = new Graphics()
      this.gameLayer.addChild(this.arrivalLine)
    }
    const { canvasHeight, playArea, worldScale } = this.game.layout
    const bottomWorldY = (canvasHeight - playArea.y) / worldScale
    const line = this.arrivalLine.clear()
    const dashHeight = 14
    const gap = 8
    let y = ARRIVAL_LINE_TOP_Y
    while (y < bottomWorldY) {
      line.moveTo(this.arrivalLineX, y).lineTo(
        this.arrivalLineX,
        Math.min(y + dashHeight, bottomWorldY),
      )
      y += dashHeight + gap
    }
    line.stroke({ width: 3, color: 0xfff700 })
  }

  private makeZombie(state: ZombieState): PlayerZombie {
    const zombie = new PlayerZombie({
      type: state.type,
      textures: this.zombieTextures(state.type),
      frameCounts: this.zombieFrameCounts(state.type),
    })
    zombie.scale.set(this.game.layout.zombieScale)
    // Local player snaps to server position; bots and other players lerp
    // between snapshots to hide the 30 Hz tick on a 60 Hz render loop.
    zombie.setInterpolated(state.id !== this.game.net.id)
    zombie.applyServerState(state)
    return zombie
  }

  private zombieTextures(
    type: ZombieType,
  ): Record<ZombieAnimation, ReturnType<typeof this.game.assets.get>> {
    const animations: ZombieAnimation[] = ['walk', 'idle', 'die', 'run']
    return Object.fromEntries(
      animations.map((a) => [a, this.game.assets.get(`${type}_${a}`)]),
    ) as Record<ZombieAnimation, ReturnType<typeof this.game.assets.get>>
  }

  private zombieFrameCounts(type: ZombieType): Record<ZombieAnimation, number> {
    const animations: ZombieAnimation[] = ['walk', 'idle', 'die', 'run']
    const result = {} as Record<ZombieAnimation, number>
    for (const a of animations) {
      const meta = ZOMBIE_SPRITES.find((s) => s.alias === `${type}_${a}`)
      if (!meta) throw new Error(`No manifest entry for ${type}_${a}`)
      result[a] = meta.frameCount
    }
    return result
  }
}
