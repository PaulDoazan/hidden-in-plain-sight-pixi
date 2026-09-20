import { BONUS_IDS } from '@hips/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AudioManager, type AudioStorage } from '../AudioManager'
import { SFX_BANK, ZOMBIE_VOICE_SAMPLES, bonusSoundEvent } from '../SoundBank'

// Minimal stand-in for the WebAudio graph: every node only has to record what
// the manager asks of it, so the scheduling logic can be asserted without a
// browser. Vitest runs in node, where AudioContext does not exist at all.
function makeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  }
}

function makeFakeContext() {
  const oscillators: { type: string; start: ReturnType<typeof vi.fn> }[] = []
  const bufferSources: { start: ReturnType<typeof vi.fn> }[] = []
  const panners: { pan: ReturnType<typeof makeParam> }[] = []
  const gains: ReturnType<typeof makeParam>[] = []
  const master = { gain: makeParam(), connect: vi.fn(), disconnect: vi.fn() }
  let gainCalls = 0

  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running' as string,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => {
      gainCalls += 1
      // The first gain the manager asks for is the master bus; the rest are
      // per-layer envelopes and the run loop's own nodes.
      if (gainCalls === 1) return master
      const gain = makeParam()
      gains.push(gain)
      return { gain, connect: vi.fn(), disconnect: vi.fn() }
    }),
    createOscillator: vi.fn(() => {
      const osc = {
        type: 'square',
        frequency: makeParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      oscillators.push(osc)
      return osc
    }),
    createBufferSource: vi.fn(() => {
      const src = {
        buffer: null,
        loop: false,
        playbackRate: makeParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      bufferSources.push(src)
      return src
    }),
    createBiquadFilter: vi.fn(() => ({
      type: 'lowpass',
      Q: makeParam(),
      frequency: makeParam(),
      connect: vi.fn(),
    })),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    createStereoPanner: vi.fn(() => {
      const panner = { pan: makeParam(), connect: vi.fn() }
      panners.push(panner)
      return panner
    }),
    // Node has no MP3 decoder; the manager only ever stores what it gets back.
    decodeAudioData: vi.fn(() => Promise.resolve({ duration: 1 } as unknown as AudioBuffer)),
  }
  return { ctx, master, oscillators, bufferSources, panners, gains }
}

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage: AudioStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
  return { storage, data }
}

const KEY = 'marche-ou-creve.audio'

// Stand-in for the detached <audio> element that streams one music track.
function makeFakeMusic() {
  return {
    loop: false,
    volume: 1,
    paused: true,
    currentTime: 0,
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true
    }),
  }
}

function makeManager(options: {
  storage?: AudioStorage | null
  now?: () => number
  fetchSample?: (url: string) => Promise<ArrayBuffer>
  music?: boolean
} = {}) {
  const fake = makeFakeContext()
  const fetched: string[] = []
  const musicByTrack = { lobby: makeFakeMusic(), round: makeFakeMusic() }
  const manager = new AudioManager({
    createContext: () => fake.ctx as unknown as AudioContext,
    createMusic: (track) =>
      options.music ? (musicByTrack[track] as unknown as HTMLAudioElement) : null,
    storage: options.storage ?? makeStorage().storage,
    now: options.now,
    fetchSample:
      options.fetchSample ??
      ((url) => {
        fetched.push(url)
        return Promise.resolve(new ArrayBuffer(8))
      }),
  })
  return { manager, fetched, musicByTrack, ...fake }
}

describe('AudioManager', () => {
  let nowMs = 0
  beforeEach(() => {
    nowMs = 0
  })

  describe('settings', () => {
    it('starts unmuted at the default volume when nothing is stored', () => {
      const { manager } = makeManager()
      expect(manager.muted).toBe(false)
      expect(manager.volume).toBe(0.6)
    })

    it('restores mute and volume from storage', () => {
      const { storage } = makeStorage({ [KEY]: JSON.stringify({ muted: true, volume: 0.25 }) })
      const { manager } = makeManager({ storage })
      expect(manager.muted).toBe(true)
      expect(manager.volume).toBe(0.25)
    })

    it('falls back to the defaults on corrupt stored settings', () => {
      const { storage } = makeStorage({ [KEY]: 'not json' })
      const { manager } = makeManager({ storage })
      expect(manager.muted).toBe(false)
      expect(manager.volume).toBe(0.6)
    })

    it('clamps an out-of-range stored volume', () => {
      const { storage } = makeStorage({ [KEY]: JSON.stringify({ volume: 12 }) })
      const { manager } = makeManager({ storage })
      expect(manager.volume).toBe(1)
    })

    it('persists a volume change', () => {
      const { storage, data } = makeStorage()
      const { manager } = makeManager({ storage })
      manager.setVolume(0.3)
      expect(JSON.parse(data.get(KEY)!)).toEqual({ muted: false, volume: 0.3 })
    })

    it('clamps the volume it is given', () => {
      const { manager } = makeManager()
      manager.setVolume(-5)
      expect(manager.volume).toBe(0)
      manager.setVolume(5)
      expect(manager.volume).toBe(1)
    })

    it('persists a mute toggle and reports the new state', () => {
      const { storage, data } = makeStorage()
      const { manager } = makeManager({ storage })
      expect(manager.toggleMute()).toBe(true)
      expect(JSON.parse(data.get(KEY)!)).toEqual({ muted: true, volume: 0.6 })
      expect(manager.toggleMute()).toBe(false)
      expect(manager.muted).toBe(false)
    })

    it('survives a storage that throws, as private-mode Safari does', () => {
      const throwing: AudioStorage = {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
      }
      const { manager } = makeManager({ storage: throwing })
      expect(manager.volume).toBe(0.6)
      expect(() => manager.setVolume(0.2)).not.toThrow()
    })

    it('works without any storage at all', () => {
      const { manager } = makeManager({ storage: null })
      expect(() => manager.toggleMute()).not.toThrow()
      expect(manager.muted).toBe(true)
    })
  })

  describe('mixing', () => {
    it('drives the master bus from the volume, and to zero when muted', () => {
      const { manager, master } = makeManager()
      manager.unlock()
      expect(master.gain.value).toBe(0.6)

      manager.setVolume(0.4)
      expect(master.gain.value).toBe(0.4)

      manager.setMuted(true)
      expect(master.gain.value).toBe(0)
      expect(manager.effectiveVolume).toBe(0)

      manager.setMuted(false)
      expect(master.gain.value).toBe(0.4)
    })
  })

  describe('music', () => {
    it('loops the lobby track from the first gesture', () => {
      const { manager, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      expect(manager.currentTrack).toBe('lobby')
      expect(musicByTrack.lobby.loop).toBe(true)
      expect(musicByTrack.lobby.paused).toBe(false)
      // The round's track is not even created before a round starts.
      expect(musicByTrack.round.play).not.toHaveBeenCalled()
    })

    it('keeps the music far under the effects bus', () => {
      const { manager, master, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      // The bed must stay a bed: a groaning zombie at a quarter of its own
      // gain still has to be audible over it.
      expect(musicByTrack.lobby.volume).toBeLessThan(master.gain.value / 4)
      expect(musicByTrack.lobby.volume).toBeGreaterThan(0)
    })

    it('follows the volume slider and stops when muted', () => {
      const { manager, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      const atDefault = musicByTrack.lobby.volume
      manager.setVolume(0.3)
      expect(musicByTrack.lobby.volume).toBeLessThan(atDefault)
      manager.setMuted(true)
      expect(musicByTrack.lobby.paused).toBe(true)
      manager.setMuted(false)
      expect(musicByTrack.lobby.paused).toBe(false)
    })

    it('hands over to the round track when a round starts', () => {
      const { manager, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      manager.playMusic('round')
      expect(manager.currentTrack).toBe('round')
      expect(musicByTrack.lobby.paused).toBe(true)
      expect(musicByTrack.round.paused).toBe(false)
      expect(musicByTrack.round.loop).toBe(true)
    })

    it('leaves the round track running for the scoreboard, then restarts it next round', () => {
      const { manager, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      manager.playMusic('round')
      // The end scene changes nothing, so a second call for the same track must
      // not restart the music under the scoreboard.
      musicByTrack.round.currentTime = 42
      manager.playMusic('round')
      expect(musicByTrack.round.currentTime).toBe(42)
      expect(musicByTrack.round.paused).toBe(false)

      // Back to the lobby: the round's track stops and rewinds, so the next
      // race starts at the top of it.
      manager.playMusic('lobby')
      expect(musicByTrack.round.paused).toBe(true)
      expect(musicByTrack.round.currentTime).toBe(0)
      expect(musicByTrack.lobby.paused).toBe(false)
    })

    it('resumes the lobby track where it left off', () => {
      const { manager, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      musicByTrack.lobby.currentTime = 30
      manager.playMusic('round')
      manager.playMusic('lobby')
      expect(musicByTrack.lobby.currentTime).toBe(30)
    })

    it('applies mute to whichever track is playing', () => {
      const { manager, musicByTrack } = makeManager({ music: true })
      manager.unlock()
      manager.playMusic('round')
      manager.setMuted(true)
      expect(musicByTrack.round.paused).toBe(true)
      manager.setMuted(false)
      expect(musicByTrack.round.paused).toBe(false)
      expect(musicByTrack.lobby.paused).toBe(true)
    })
  })

  describe('playback', () => {
    it('plays nothing before the first user gesture unlocks the context', () => {
      const { manager, oscillators } = makeManager()
      manager.play('ui-click')
      expect(manager.isUnlocked).toBe(false)
      expect(oscillators).toHaveLength(0)
    })

    it('schedules one source per layer of the resolved spec', () => {
      const { manager, oscillators, bufferSources } = makeManager()
      manager.unlock()
      manager.play('shot')
      // `shot` is one noise layer plus one tone layer.
      expect(bufferSources).toHaveLength(1)
      expect(oscillators).toHaveLength(1)
      expect(oscillators[0]!.start).toHaveBeenCalled()
    })

    it('stays silent while muted', () => {
      const { manager, oscillators } = makeManager()
      manager.unlock()
      manager.setMuted(true)
      manager.play('victory')
      expect(oscillators).toHaveLength(0)
    })

    it('throttles a repeat of the same effect, as a bomb killing a crowd does', () => {
      const { manager, oscillators } = makeManager({ now: () => nowMs })
      manager.unlock()
      manager.play('death')
      const afterFirst = oscillators.length
      manager.play('death')
      expect(oscillators).toHaveLength(afterFirst)

      // Past the spec's throttle window the effect is audible again.
      nowMs += SFX_BANK.death.throttleMs + 1
      manager.play('death')
      expect(oscillators.length).toBeGreaterThan(afterFirst)
    })

    it('does not throttle two different effects', () => {
      const { manager, oscillators } = makeManager({ now: () => nowMs })
      manager.unlock()
      manager.play('ui-click')
      manager.play('ui-cancel')
      expect(oscillators).toHaveLength(2)
    })

    it('unlocks only once', () => {
      const { manager, ctx } = makeManager()
      manager.unlock()
      manager.unlock()
      expect(ctx.createGain).toHaveBeenCalledTimes(1)
    })

    it('ignores an unknown or not-yet-loaded zombie voice', () => {
      const { manager, bufferSources } = makeManager()
      manager.unlock()
      manager.playVoice('idle-1')
      expect(bufferSources).toHaveLength(0)
    })

    it('resumes a context suspended by a tab switch', () => {
      const { manager, ctx } = makeManager()
      manager.unlock()
      ctx.state = 'suspended'
      manager.play('ui-click')
      expect(ctx.resume).toHaveBeenCalled()
    })
  })
})

describe('AudioManager running loop', () => {
  // The level node is the last gain the run loop builds, after the stride pair.
  const levelOf = (gains: ReturnType<typeof makeFakeContext>['gains']) => gains.at(-1)!

  it('builds nothing while nobody runs', () => {
    const { manager, ctx } = makeManager()
    manager.unlock()
    manager.setRunLoop(0, 0)
    expect(ctx.createOscillator).not.toHaveBeenCalled()
    expect(ctx.createBufferSource).not.toHaveBeenCalled()
  })

  it('does nothing before the first gesture', () => {
    const { manager, ctx } = makeManager()
    manager.setRunLoop(1, 0)
    expect(ctx.createBufferSource).not.toHaveBeenCalled()
  })

  it('starts a looping, pulsing bed the first time someone runs', () => {
    const { manager, ctx, bufferSources, oscillators } = makeManager()
    manager.unlock()
    manager.setRunLoop(0.5, 0)
    // A looping noise source for the feet and an oscillator driving the stride.
    expect(bufferSources).toHaveLength(1)
    expect(bufferSources[0]!.start).toHaveBeenCalled()
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0]!.start).toHaveBeenCalled()
    expect(ctx.createBiquadFilter).toHaveBeenCalled()
  })

  it('reuses the same graph on every frame', () => {
    const { manager, bufferSources } = makeManager()
    manager.unlock()
    for (let i = 0; i < 100; i++) manager.setRunLoop(0.5, 0)
    expect(bufferSources).toHaveLength(1)
  })

  it('ramps the level with the intensity instead of cutting it', () => {
    const { manager, gains } = makeManager()
    manager.unlock()
    manager.setRunLoop(1, 0)
    const level = levelOf(gains)
    const loud = level.setTargetAtTime.mock.calls.at(-1)![0] as number
    manager.setRunLoop(0.25, 0)
    const quiet = level.setTargetAtTime.mock.calls.at(-1)![0] as number
    expect(loud).toBeGreaterThan(quiet)
    expect(quiet).toBeGreaterThan(0)

    // Everyone stopped: it fades to silence, but the graph stays alive.
    manager.setRunLoop(0, 0)
    expect(level.setTargetAtTime.mock.calls.at(-1)![0]).toBe(0)
  })

  it('follows the runners across the stereo field, clamped', () => {
    const { manager, panners } = makeManager()
    manager.unlock()
    manager.setRunLoop(1, -4)
    expect(panners[0]!.pan.setTargetAtTime.mock.calls.at(-1)![0]).toBe(-1)
  })
})

describe('AudioManager zombie voices', () => {
  it('fetches every take once the first gesture unlocks the context', async () => {
    const { manager, fetched } = makeManager()
    manager.unlock()
    await vi.waitFor(() => expect(manager.loadedVoiceCount).toBe(ZOMBIE_VOICE_SAMPLES.length))
    expect(fetched).toHaveLength(ZOMBIE_VOICE_SAMPLES.length)
    expect(fetched[0]).toMatch(/^\/assets\/audio\/zombie\/.+\.mp3$/)
  })

  it('carries on when a take fails to load', async () => {
    const { manager } = makeManager({
      fetchSample: (url) =>
        url.includes('idle-1') ? Promise.reject(new Error('404')) : Promise.resolve(new ArrayBuffer(8)),
    })
    manager.unlock()
    await vi.waitFor(() =>
      expect(manager.loadedVoiceCount).toBe(ZOMBIE_VOICE_SAMPLES.length - 1),
    )
  })

  it('plays a loaded take, panned and attenuated as asked', async () => {
    const { manager, bufferSources, panners } = makeManager()
    manager.unlock()
    await vi.waitFor(() => expect(manager.loadedVoiceCount).toBeGreaterThan(0))
    manager.playVoice('walk-1', { pan: -0.5, gain: 0.5, rate: 1.1 })
    expect(bufferSources).toHaveLength(1)
    expect(panners[0]!.pan.value).toBe(-0.5)
  })

  it('clamps a pan that came in out of range', async () => {
    const { manager, panners } = makeManager()
    manager.unlock()
    await vi.waitFor(() => expect(manager.loadedVoiceCount).toBeGreaterThan(0))
    manager.playVoice('walk-1', { pan: -12 })
    expect(panners[0]!.pan.value).toBe(-1)
  })

  it('stays silent while muted', async () => {
    const { manager, bufferSources } = makeManager()
    manager.unlock()
    await vi.waitFor(() => expect(manager.loadedVoiceCount).toBeGreaterThan(0))
    manager.setMuted(true)
    manager.playVoice('walk-1')
    expect(bufferSources).toHaveLength(0)
  })

  it('rate-limits takes that share a throttle key, as a bomb makes it do', async () => {
    let nowMs = 0
    const { manager, bufferSources } = makeManager({ now: () => nowMs })
    manager.unlock()
    await vi.waitFor(() => expect(manager.loadedVoiceCount).toBeGreaterThan(0))
    const options = { throttleKey: 'death', throttleMs: 160 }
    manager.playVoice('death-1', options)
    manager.playVoice('death-2', options)
    expect(bufferSources).toHaveLength(1)
    nowMs += 200
    manager.playVoice('death-3', options)
    expect(bufferSources).toHaveLength(2)
  })

  it('caps how many voices can overlap, so a wave of deaths cannot drown the round', async () => {
    const { manager, bufferSources } = makeManager()
    manager.unlock()
    await vi.waitFor(() => expect(manager.loadedVoiceCount).toBeGreaterThan(0))
    for (let i = 0; i < 20; i++) manager.playVoice('death-1')
    expect(bufferSources.length).toBeLessThanOrEqual(6)
    expect(bufferSources.length).toBeGreaterThan(0)
  })
})

describe('SoundBank', () => {
  it('maps every bonus to a sound of its own', () => {
    for (const bonusId of BONUS_IDS) {
      expect(bonusSoundEvent(bonusId)).toBe(`bonus-${bonusId}`)
      expect(SFX_BANK[bonusSoundEvent(bonusId)]).toBeDefined()
    }
  })

  it('falls back to a known sound for a bonus with no signature', () => {
    // A BonusId added server-side before the bank catches up must not throw.
    const event = bonusSoundEvent('brand-new-bonus' as never)
    expect(SFX_BANK[event]).toBeDefined()
  })

  it('describes every effect with at least one audible layer', () => {
    for (const [name, spec] of Object.entries(SFX_BANK)) {
      expect(spec.layers.length, name).toBeGreaterThan(0)
      for (const layer of spec.layers) {
        expect(layer.duration, name).toBeGreaterThan(0)
        expect(layer.gain, name).toBeGreaterThan(0)
      }
    }
  })
})
