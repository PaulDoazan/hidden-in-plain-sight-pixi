import type { ZombieAnimation } from '@hips/shared'

import { pickZombieVoice, type ZombieVoiceState } from './SoundBank'

// Only what the scheduler needs from a zombie — PlayerZombie satisfies it, and
// a test can pass plain objects.
export interface AmbientBody {
  x: number
  isAlive: boolean
  animation: ZombieAnimation | null
}

// Deliberately shaped like Layout's own fields, so callers can hand over the
// layout itself instead of restating it.
export interface AmbienceContext {
  canvasWidth: number
  // Where the world starts on screen, and how much it is scaled: together they
  // turn a world x into the screen x a groan should be panned to.
  playArea: { x: number }
  worldScale: number
  // World x of the zombie the player is looking through, used for distance
  // attenuation. Null before the round starts.
  listenerX: number | null
}

export interface AmbientVoice {
  sample: string
  pan: number
  gain: number
  rate: number
}

// Continuous layer, recomputed every frame: how much running there is on
// screen and where it is coming from. Unlike the one-shot voices this is a
// state, not an event — a zombie that starts running must be heard for as long
// as it runs, not once when it sets off.
export interface RunReading {
  intensity: number
  pan: number
}

export interface AmbienceUpdate {
  voices: AmbientVoice[]
  run: RunReading
}

// Weighted runners needed for the loop to reach full level. Low on purpose:
// the player's own sprint (weight 1, since the listener is at distance 0) has
// to be plainly audible on its own.
const RUN_SATURATION = 2.5

// How long a body stays quiet between two vocalisations, per state. A resting
// zombie groans rarely, a running one is agitated — and the wide random spread
// is what keeps sixty bodies from ever falling into a rhythm.
const INTERVAL_MS: Record<ZombieVoiceState, { min: number; max: number }> = {
  idle: { min: 5000, max: 11000 },
  walk: { min: 3000, max: 7000 },
  run: { min: 1500, max: 3500 },
  death: { min: 0, max: 0 },
}

// Relative loudness per state, before distance attenuation.
const STATE_GAIN: Record<ZombieVoiceState, number> = {
  idle: 0.5,
  walk: 0.65,
  run: 0.9,
  death: 1,
}

// The one knob that makes a horde bearable: whatever the crowd wants, at most
// one voice starts every this many milliseconds. Bodies that were due while
// the floor was closed simply wait for their next turn instead of queueing up.
const VOICE_FLOOR_MS = 220

// Distance (world units) at which a voice reaches its quietest. Beyond the
// viewport a body is skipped entirely, so this only shapes what is on screen.
const FALLOFF_WORLD = 1400
const MIN_DISTANCE_GAIN = 0.25
const SCREEN_MARGIN = 80

// Above this many tracked bodies the timer map is swept for ids that no longer
// exist — rounds end, bots are recycled, and ids never come back.
const PRUNE_THRESHOLD = 128

// Decides which zombies are heard and when. Kept apart from AudioManager
// because this is scheduling policy, not audio plumbing: it is the piece that
// has to be tuned (and tested) so a field full of bodies reads as a murmur.
export class ZombieAmbience {
  private readonly nextDueAt = new Map<string, number>()
  private lastVoiceAt = 0

  constructor(private readonly random: () => number = Math.random) {}

  // Returns the voices to start this frame — at most one, by design — and the
  // running level for the continuous loop. Bodies are passed as the scene's own
  // map, so a frame where nothing is due allocates nothing but the reading.
  update(
    bodies: Iterable<[string, AmbientBody]>,
    context: AmbienceContext,
    now: number,
  ): AmbienceUpdate {
    const floorOpen = now - this.lastVoiceAt >= VOICE_FLOOR_MS
    const voices: AmbientVoice[] = []
    let tracked = 0
    // Running bodies are summed by audible weight rather than counted: a
    // sprinter at the far edge of the screen must not weigh as much as the one
    // next to you.
    let runWeight = 0
    let runPanSum = 0

    for (const [id, body] of bodies) {
      tracked += 1
      const state = voiceState(body)
      if (!state) {
        // A dead or dying body has no ambience; its death sound is played by
        // the kill event instead.
        this.nextDueAt.delete(id)
        continue
      }

      if (state === 'run' && onScreen(body, context)) {
        const weight = distanceGain(body.x, context.listenerX)
        runWeight += weight
        runPanSum += pan(screenXOf(body, context), context.canvasWidth) * weight
      }

      const due = this.nextDueAt.get(id)
      if (due === undefined) {
        // Stagger newcomers across the interval rather than having a whole
        // freshly spawned field vocalise at once.
        this.nextDueAt.set(id, now + this.interval(state) * this.random())
        continue
      }
      if (now < due) continue

      this.nextDueAt.set(id, now + this.interval(state))
      // Everything below is "should this particular due body be audible now".
      if (!floorOpen || voices.length > 0) continue

      if (!onScreen(body, context)) continue
      const screenX = screenXOf(body, context)

      voices.push({
        sample: pickZombieVoice(state, this.random),
        pan: pan(screenX, context.canvasWidth),
        gain: STATE_GAIN[state] * distanceGain(body.x, context.listenerX),
        // A few percent of detune per take, so three samples never sound like
        // three samples.
        rate: 0.92 + this.random() * 0.18,
      })
      this.lastVoiceAt = now
    }

    if (this.nextDueAt.size > Math.max(PRUNE_THRESHOLD, tracked * 2)) {
      this.prune(bodies)
    }
    return {
      voices,
      run: {
        intensity: Math.min(1, runWeight / RUN_SATURATION),
        pan: runWeight > 0 ? runPanSum / runWeight : 0,
      },
    }
  }

  reset(): void {
    this.nextDueAt.clear()
  }

  private interval(state: ZombieVoiceState): number {
    const { min, max } = INTERVAL_MS[state]
    return min + this.random() * (max - min)
  }

  private prune(bodies: Iterable<[string, AmbientBody]>): void {
    const alive = new Set<string>()
    for (const [id] of bodies) alive.add(id)
    for (const id of this.nextDueAt.keys()) {
      if (!alive.has(id)) this.nextDueAt.delete(id)
    }
  }
}

function screenXOf(body: AmbientBody, context: AmbienceContext): number {
  return context.playArea.x + body.x * context.worldScale
}

// Slack around the viewport so a body about to walk into view is not abruptly
// switched on.
function onScreen(body: AmbientBody, context: AmbienceContext): boolean {
  const screenX = screenXOf(body, context)
  return screenX >= -SCREEN_MARGIN && screenX <= context.canvasWidth + SCREEN_MARGIN
}

// 'die' is deliberately absent: a death is an event, not an ambience.
function voiceState(body: AmbientBody): ZombieVoiceState | null {
  if (!body.isAlive) return null
  if (body.animation === 'idle') return 'idle'
  if (body.animation === 'walk') return 'walk'
  if (body.animation === 'run') return 'run'
  return null
}

export function pan(screenX: number, canvasWidth: number): number {
  if (canvasWidth <= 0) return 0
  // Only ±0.8: hard-panned voices feel detached from the picture, especially
  // on headphones.
  return Math.min(1, Math.max(-1, ((screenX / canvasWidth) * 2 - 1) * 0.8))
}

// Screen-space pan for an arbitrary world x, shared with the one-shot sounds
// the scene plays outside the ambience loop (a death, for instance).
export function panForWorldX(
  worldX: number,
  context: Pick<AmbienceContext, 'canvasWidth' | 'playArea' | 'worldScale'>,
): number {
  return pan(context.playArea.x + worldX * context.worldScale, context.canvasWidth)
}

function distanceGain(x: number, listenerX: number | null): number {
  if (listenerX === null) return 1
  const distance = Math.abs(x - listenerX)
  const attenuated = 1 - distance / FALLOFF_WORLD
  return Math.min(1, Math.max(MIN_DISTANCE_GAIN, attenuated))
}
