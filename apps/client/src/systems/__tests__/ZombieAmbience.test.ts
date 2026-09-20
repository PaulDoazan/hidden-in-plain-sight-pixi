import { describe, expect, it } from 'vitest'

import { ZOMBIE_VOICES, ZOMBIE_VOICE_SAMPLES, pickZombieVoice } from '../SoundBank'
import {
  ZombieAmbience,
  pan,
  panForWorldX,
  type AmbienceContext,
  type AmbientBody,
} from '../ZombieAmbience'

const CONTEXT: AmbienceContext = {
  canvasWidth: 1000,
  playArea: { x: 0 },
  worldScale: 0.5,
  listenerX: 0,
}

function body(x: number, animation: AmbientBody['animation'] = 'walk'): AmbientBody {
  return { x, isAlive: true, animation }
}

// A fixed "random" keeps the intervals and the chosen take deterministic.
const half = () => 0.5

describe('ZombieAmbience voices', () => {
  it('stays silent on a body it has never seen, to stagger a fresh spawn', () => {
    const ambience = new ZombieAmbience(half)
    const bodies: [string, AmbientBody][] = [['a', body(100)]]
    expect(ambience.update(bodies, CONTEXT, 0).voices).toHaveLength(0)
  })

  it('voices a body once its interval has elapsed', () => {
    const ambience = new ZombieAmbience(half)
    const bodies: [string, AmbientBody][] = [['a', body(1000)]]
    ambience.update(bodies, CONTEXT, 0)
    expect(ambience.update(bodies, CONTEXT, 1000).voices).toHaveLength(0)
    const { voices } = ambience.update(bodies, CONTEXT, 60_000)
    expect(voices).toHaveLength(1)
    expect(ZOMBIE_VOICES.walk).toContain(voices[0]!.sample)
  })

  it('starts at most one voice per frame however big the horde', () => {
    const ambience = new ZombieAmbience(half)
    const bodies: [string, AmbientBody][] = Array.from({ length: 60 }, (_, i) => [
      `z${i}`,
      body(i * 10),
    ])
    ambience.update(bodies, CONTEXT, 0)
    expect(ambience.update(bodies, CONTEXT, 60_000).voices).toHaveLength(1)
  })

  it('keeps a floor between two voices, so a crowd never machine-guns', () => {
    const ambience = new ZombieAmbience(half)
    const a: [string, AmbientBody][] = [['a', body(0, 'run')]]
    const both: [string, AmbientBody][] = [...a, ['b', body(10, 'run')]]
    // 'a' is registered 100 ms before 'b', so their turns come 100 ms apart —
    // closer than the floor allows.
    ambience.update(a, CONTEXT, 0)
    ambience.update(both, CONTEXT, 100)
    expect(ambience.update(both, CONTEXT, 1250).voices).toHaveLength(1)
    // 'b' is due here, but the floor is still closed, so it waits for its next
    // turn rather than piling onto 'a'.
    expect(ambience.update(both, CONTEXT, 1350).voices).toHaveLength(0)
  })

  it('picks the sound from what the body is doing', () => {
    for (const animation of ['idle', 'walk', 'run'] as const) {
      const ambience = new ZombieAmbience(half)
      const bodies: [string, AmbientBody][] = [['a', body(1000, animation)]]
      ambience.update(bodies, CONTEXT, 0)
      const { voices } = ambience.update(bodies, CONTEXT, 60_000)
      expect(ZOMBIE_VOICES[animation]).toContain(voices[0]!.sample)
    }
  })

  it('has nothing to say about a dead or dying body', () => {
    const ambience = new ZombieAmbience(half)
    const dead: [string, AmbientBody][] = [['a', { x: 100, isAlive: false, animation: 'die' }]]
    ambience.update(dead, CONTEXT, 0)
    expect(ambience.update(dead, CONTEXT, 60_000).voices).toHaveLength(0)
  })

  it('skips a body that stands outside the viewport', () => {
    const ambience = new ZombieAmbience(half)
    // worldScale 0.5 → world x 100000 lands far off the right edge.
    const bodies: [string, AmbientBody][] = [['a', body(100_000)]]
    ambience.update(bodies, CONTEXT, 0)
    expect(ambience.update(bodies, CONTEXT, 60_000).voices).toHaveLength(0)
  })

  it('fades a body out with its distance from the listener', () => {
    const near = new ZombieAmbience(half)
    const far = new ZombieAmbience(half)
    const nearBodies: [string, AmbientBody][] = [['a', body(0)]]
    const farBodies: [string, AmbientBody][] = [['a', body(1800)]]
    near.update(nearBodies, CONTEXT, 0)
    far.update(farBodies, CONTEXT, 0)
    const nearGain = near.update(nearBodies, CONTEXT, 60_000).voices[0]!.gain
    const farGain = far.update(farBodies, CONTEXT, 60_000).voices[0]!.gain
    expect(farGain).toBeLessThan(nearGain)
    expect(farGain).toBeGreaterThan(0)
  })

  it('runs louder than it idles', () => {
    const gainFor = (animation: 'idle' | 'run') => {
      const ambience = new ZombieAmbience(half)
      const bodies: [string, AmbientBody][] = [['a', body(0, animation)]]
      ambience.update(bodies, CONTEXT, 0)
      return ambience.update(bodies, CONTEXT, 60_000).voices[0]!.gain
    }
    expect(gainFor('run')).toBeGreaterThan(gainFor('idle'))
  })

  it('detunes each take instead of replaying it identically', () => {
    const ambience = new ZombieAmbience(() => 0.25)
    const bodies: [string, AmbientBody][] = [['a', body(0)]]
    ambience.update(bodies, CONTEXT, 0)
    const voice = ambience.update(bodies, CONTEXT, 60_000).voices[0]!
    expect(voice.rate).toBeGreaterThan(0.8)
    expect(voice.rate).toBeLessThan(1.2)
    expect(voice.rate).not.toBe(1)
  })

  it('forgets a body it no longer sees', () => {
    const ambience = new ZombieAmbience(half)
    const many: [string, AmbientBody][] = Array.from({ length: 200 }, (_, i) => [
      `z${i}`,
      body(i),
    ])
    ambience.update(many, CONTEXT, 0)
    const few: [string, AmbientBody][] = [['z0', body(0)]]
    ambience.update(few, CONTEXT, 1000)
    // The sweep has run, so the 199 gone bodies no longer hold a timer: z0 is
    // the only one that can still be due.
    expect(ambience.update(few, CONTEXT, 60_000).voices).toHaveLength(1)
  })

  it('resets its timers between rounds', () => {
    const ambience = new ZombieAmbience(half)
    const bodies: [string, AmbientBody][] = [['a', body(0)]]
    ambience.update(bodies, CONTEXT, 0)
    ambience.reset()
    // Forgotten, so the body is staggered again rather than immediately due.
    expect(ambience.update(bodies, CONTEXT, 60_000).voices).toHaveLength(0)
  })
})

describe('ZombieAmbience running level', () => {
  const runOf = (bodies: [string, AmbientBody][], context = CONTEXT) =>
    new ZombieAmbience(half).update(bodies, context, 0).run

  it('is silent when nothing runs', () => {
    expect(runOf([['a', body(0, 'walk')], ['b', body(10, 'idle')]]).intensity).toBe(0)
  })

  it('rises as soon as one zombie runs, and keeps rising with the pack', () => {
    const one = runOf([['a', body(0, 'run')]]).intensity
    const three = runOf([
      ['a', body(0, 'run')],
      ['b', body(10, 'run')],
      ['c', body(20, 'run')],
    ]).intensity
    expect(one).toBeGreaterThan(0)
    expect(three).toBeGreaterThan(one)
  })

  it('never goes past full, however big the stampede', () => {
    const bodies: [string, AmbientBody][] = Array.from({ length: 40 }, (_, i) => [
      `z${i}`,
      body(i, 'run'),
    ])
    expect(runOf(bodies).intensity).toBe(1)
  })

  it('weighs a distant runner less than one next to the player', () => {
    const near = runOf([['a', body(0, 'run')]]).intensity
    const far = runOf([['a', body(1300, 'run')]]).intensity
    expect(far).toBeLessThan(near)
    expect(far).toBeGreaterThan(0)
  })

  it('ignores a runner off screen', () => {
    expect(runOf([['a', body(100_000, 'run')]]).intensity).toBe(0)
  })

  it('ignores a dead body stuck on the run frame', () => {
    expect(runOf([['a', { x: 0, isAlive: false, animation: 'run' }]]).intensity).toBe(0)
  })

  it('points at where the runners are', () => {
    // worldScale 0.5 on a 1000 px canvas: world 0 is hard left, 2000 hard right.
    expect(runOf([['a', body(0, 'run')]]).pan).toBeLessThan(0)
    expect(runOf([['a', body(2000, 'run')]], { ...CONTEXT, listenerX: 2000 }).pan).toBeGreaterThan(0)
    // One on each side averages back to the centre.
    expect(
      runOf(
        [
          ['a', body(0, 'run')],
          ['b', body(2000, 'run')],
        ],
        { ...CONTEXT, listenerX: 1000 },
      ).pan,
    ).toBeCloseTo(0, 5)
  })

  it('is centred when nobody runs, rather than stuck where the last one was', () => {
    expect(runOf([['a', body(0, 'walk')]]).pan).toBe(0)
  })
})

describe('panning', () => {
  it('maps the screen to the stereo field, without hard-panning', () => {
    expect(pan(500, 1000)).toBe(0)
    expect(pan(0, 1000)).toBeCloseTo(-0.8, 5)
    expect(pan(1000, 1000)).toBeCloseTo(0.8, 5)
    expect(pan(-500, 1000)).toBe(-1)
  })

  it('survives a zero-width canvas', () => {
    expect(pan(10, 0)).toBe(0)
  })

  it('pans a world position through the play area transform', () => {
    expect(panForWorldX(1000, { canvasWidth: 1000, playArea: { x: 0 }, worldScale: 0.5 })).toBe(0)
  })
})

describe('zombie voice bank', () => {
  it('offers several takes per state', () => {
    for (const [state, takes] of Object.entries(ZOMBIE_VOICES)) {
      expect(takes.length, state).toBeGreaterThan(1)
    }
  })

  it('picks a take that belongs to the requested state', () => {
    expect(ZOMBIE_VOICES.run).toContain(pickZombieVoice('run', () => 0.99))
    expect(ZOMBIE_VOICES.death).toContain(pickZombieVoice('death', () => 0))
  })

  it('never falls off the end of a take list on random() === 1', () => {
    expect(ZOMBIE_VOICES.idle).toContain(pickZombieVoice('idle', () => 1))
  })

  it('lists every take exactly once for preloading', () => {
    expect(new Set(ZOMBIE_VOICE_SAMPLES).size).toBe(ZOMBIE_VOICE_SAMPLES.length)
  })
})
