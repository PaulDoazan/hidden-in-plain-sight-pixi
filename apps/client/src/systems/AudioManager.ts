import {
  SFX_BANK,
  ZOMBIE_VOICE_SAMPLES,
  zombieVoiceUrl,
  type SfxLayer,
  type SfxSpec,
  type SoundEvent,
} from './SoundBank'

// Two tracks: one for the menu, the room and the draft, another that carries a
// running round all the way through the scoreboard. Each is encoded twice —
// Ogg/Opus is ~30 % lighter and covers Chrome/Firefox/Edge, MP3 is the fallback
// Safari actually decodes — and the <audio> element picks the first source it
// can play, so nothing has to sniff the browser.
export type MusicTrack = 'lobby' | 'round'

const MUSIC_TRACKS: Record<MusicTrack, { src: string; type: string }[]> = {
  lobby: [
    { src: '/assets/audio/lobby.ogg', type: 'audio/ogg; codecs=opus' },
    { src: '/assets/audio/lobby.mp3', type: 'audio/mpeg' },
  ],
  round: [
    { src: '/assets/audio/round.ogg', type: 'audio/ogg; codecs=opus' },
    { src: '/assets/audio/round.mp3', type: 'audio/mpeg' },
  ],
}

// Same namespace as the username key in HomeScene.
const SETTINGS_KEY = 'marche-ou-creve.audio'
const DEFAULT_VOLUME = 0.6
// The music is a bed, not the show: it sits far under the effects so a gunshot
// — and above all the groaning horde, which is quiet by nature — still cuts
// through it at any master volume.
const MUSIC_MIX = 0.12
// Default gap between two plays of the same effect, when its spec has none.
const DEFAULT_THROTTLE_MS = 60
// Hard ceiling on simultaneous layers. A round with eight players shooting and
// a bomb going off can schedule dozens of nodes in one frame; past this point
// they only add clipping, so extra plays are dropped rather than mixed.
const MAX_LIVE_LAYERS = 48
// The zombie crowd carries the atmosphere, so it is mixed close to the
// gameplay effects. What keeps a field of sixty bodies a murmur rather than a
// wall is the scheduling in ZombieAmbience and this voice cap, not a low gain —
// turning the gain down instead would have buried the groans under the music.
const VOICE_MIX = 0.8
const MAX_LIVE_VOICES = 6
// Sustained layer under the one-shot groans, for zombies that are running: a
// dry shuffle of feet, pulsed by an LFO so it reads as a stride rather than as
// a hiss. One graph for the whole field, its level and position driven by who
// is running — a loop per body would be dozens of nodes for the same result.
const RUN_LOOP_MIX = 0.55
// Footfalls per second, and how deep the pulse cuts into the bed.
const RUN_STRIDE_HZ = 4.2
const RUN_PULSE_DEPTH = 0.55
// Seconds for the loop to follow a change in intensity. Long enough that a
// zombie flickering between walk and run does not machine-gun the level.
const RUN_RAMP_SECONDS = 0.12

export interface AudioStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface AudioManagerOptions {
  // Injected so tests can drive the manager without a real WebAudio stack, and
  // so the context is only constructed when the browser actually allows it.
  createContext?: () => AudioContext | null
  storage?: AudioStorage | null
  createMusic?: (track: MusicTrack) => HTMLAudioElement | null
  now?: () => number
  // Fetches one zombie voice sample. Injected for the same reason: node has
  // neither fetch-to-ArrayBuffer semantics worth relying on nor an MP3 decoder.
  fetchSample?: (url: string) => Promise<ArrayBuffer>
}

export interface VoiceOptions {
  // -1 hard left … 1 hard right, so a groan comes from where the body stands.
  pan?: number
  gain?: number
  // Playback rate, used to detune each take a little.
  rate?: number
  // Rate limit shared by every take that names the same key. A bomb kills a
  // dozen bodies in one tick, and a dozen death groans in the same instant is
  // noise, not horror.
  throttleKey?: string
  throttleMs?: number
}

interface PersistedSettings {
  muted: boolean
  volume: number
}

// The running-feet graph, kept alive for the whole session once built: two
// source nodes that never stop, whose level is ramped up and down instead.
interface RunLoop {
  source: AudioBufferSourceNode
  lfo: OscillatorNode
  level: GainNode
  panner: StereoPannerNode | null
}

// Owns everything that makes noise: one WebAudio graph for the procedural
// effects (see SoundBank) and one streaming <audio> element per music track.
// Lives outside the scene tree because sound has to survive scene changes —
// the round's track has to keep playing across the cut to the scoreboard.
export class AudioManager {
  private readonly createContext: () => AudioContext | null
  private readonly storage: AudioStorage | null
  private readonly createMusic: (track: MusicTrack) => HTMLAudioElement | null
  private readonly now: () => number
  private readonly fetchSample: (url: string) => Promise<ArrayBuffer>

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  // One element per track, created the first time that track is asked for so a
  // player who never starts a round never downloads the round's music.
  private readonly musicElements = new Map<MusicTrack, HTMLAudioElement>()
  private track: MusicTrack = 'lobby'
  private noiseBuffer: AudioBuffer | null = null
  private unlocked = false
  private musicWanted = true
  private liveLayers = 0
  private liveVoices = 0
  private readonly lastPlayedAt = new Map<string, number>()
  // Decoded zombie voices, keyed by sample name. Empty until the first gesture
  // unlocks the context: decoding needs one, and nothing can be heard before.
  private readonly voices = new Map<string, AudioBuffer>()
  private voicesRequested = false
  // Persistent running-feet loop — see setRunLoop.
  private runLoop: RunLoop | null = null

  private muted_ = false
  private volume_ = DEFAULT_VOLUME

  constructor(options: AudioManagerOptions = {}) {
    this.createContext = options.createContext ?? defaultCreateContext
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
    this.createMusic = options.createMusic ?? defaultCreateMusic
    this.now = options.now ?? (() => Date.now())
    this.fetchSample = options.fetchSample ?? defaultFetchSample
    const stored = this.loadSettings()
    this.muted_ = stored.muted
    this.volume_ = stored.volume
  }

  get muted(): boolean {
    return this.muted_
  }

  get volume(): number {
    return this.volume_
  }

  // What both the effects bus and the music element are actually scaled by.
  get effectiveVolume(): number {
    return this.muted_ ? 0 : this.volume_
  }

  setVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : DEFAULT_VOLUME))
    if (clamped === this.volume_) return
    this.volume_ = clamped
    this.applyVolume()
    this.saveSettings()
  }

  setMuted(value: boolean): void {
    if (value === this.muted_) return
    this.muted_ = value
    this.applyVolume()
    this.saveSettings()
    // Unmuting mid-session is itself a user gesture, so it is a valid moment to
    // (re)start a music track the autoplay policy refused earlier.
    if (!value) this.startMusic()
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted_)
    return this.muted_
  }

  // Browsers refuse to start any audio before a real user gesture, so nothing
  // is created until the first click/tap/keypress. Idempotent: callers can wire
  // it to several events and let the first one win.
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    const ctx = this.createContext()
    if (ctx) {
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.effectiveVolume
      this.master.connect(ctx.destination)
    }
    this.resumeContext()
    this.startMusic()
    void this.loadZombieVoices()
  }

  // Fire-and-forget: the crowd fades in as its takes land, and a sample that
  // fails to load simply never plays. Nothing gameplay-critical waits on this,
  // so it deliberately stays out of the loading screen.
  private async loadZombieVoices(): Promise<void> {
    if (this.voicesRequested) return
    this.voicesRequested = true
    const ctx = this.ctx
    if (!ctx) return
    await Promise.all(
      ZOMBIE_VOICE_SAMPLES.map(async (sample) => {
        try {
          const encoded = await this.fetchSample(zombieVoiceUrl(sample))
          this.voices.set(sample, await ctx.decodeAudioData(encoded))
        } catch {
          // A missing or undecodable take is not worth breaking a round over.
        }
      }),
    )
  }

  get loadedVoiceCount(): number {
    return this.voices.size
  }

  // Continuous sound of zombies running, as long as any of them is. `intensity`
  // is 0 when nobody runs and 1 for a full stampede; `pan` follows where the
  // runners are. Called every frame with a fresh reading, and smoothed here, so
  // callers never have to think about starting or stopping anything.
  setRunLoop(intensity: number, pan: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const target = Math.min(1, Math.max(0, intensity))
    // Nothing is running and nothing ever has: no reason to build the graph.
    if (!this.runLoop && target === 0) return

    const loop = this.runLoop ?? this.buildRunLoop(ctx, master)
    if (!loop) return
    this.resumeContext()
    loop.level.gain.setTargetAtTime(target * RUN_LOOP_MIX, ctx.currentTime, RUN_RAMP_SECONDS)
    if (loop.panner) {
      loop.panner.pan.setTargetAtTime(
        Math.min(1, Math.max(-1, pan)),
        ctx.currentTime,
        RUN_RAMP_SECONDS,
      )
    }
  }

  private buildRunLoop(ctx: AudioContext, master: GainNode): RunLoop | null {
    const source = this.makeNoiseSource(ctx)

    // Band-limited noise is what turns a hiss into feet on dirt.
    const body = ctx.createBiquadFilter()
    body.type = 'bandpass'
    body.frequency.value = 900
    body.Q.value = 0.8

    // The stride: an oscillator driving the gain param, so the bed pulses
    // instead of droning. Its own gain sets how deep each footfall cuts.
    const stride = ctx.createGain()
    stride.gain.value = 1 - RUN_PULSE_DEPTH
    const lfo = ctx.createOscillator()
    lfo.type = 'triangle'
    lfo.frequency.value = RUN_STRIDE_HZ
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = RUN_PULSE_DEPTH
    lfo.connect(lfoDepth)
    lfoDepth.connect(stride.gain)

    // Starts silent: the caller's first reading ramps it in.
    const level = ctx.createGain()
    level.gain.value = 0

    source.connect(body)
    body.connect(stride)
    stride.connect(level)

    let panner: StereoPannerNode | null = null
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner()
      level.connect(panner)
      panner.connect(master)
    } else {
      level.connect(master)
    }

    source.start()
    lfo.start()
    this.runLoop = { source, lfo, level, panner }
    return this.runLoop
  }

  // One-shot zombie voice, positioned in the stereo field and attenuated by
  // the caller. Voices are capped on their own so a wave of deaths can never
  // crowd out the gameplay effects.
  playVoice(sample: string, options: VoiceOptions = {}): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.muted_ || this.volume_ === 0) return
    const buffer = this.voices.get(sample)
    if (!buffer) return
    if (this.liveVoices >= MAX_LIVE_VOICES) return

    if (options.throttleKey) {
      const key = `voice:${options.throttleKey}`
      const now = this.now()
      const last = this.lastPlayedAt.get(key)
      if (last !== undefined && now - last < (options.throttleMs ?? DEFAULT_THROTTLE_MS)) return
      this.lastPlayedAt.set(key, now)
    }

    this.resumeContext()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = options.rate ?? 1

    const gain = ctx.createGain()
    gain.gain.value = Math.max(0, options.gain ?? 1) * VOICE_MIX
    source.connect(gain)

    // Panning is a nicety, not a requirement: an old browser without
    // StereoPannerNode still hears the crowd, just centred.
    let tail: AudioNode = gain
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.min(1, Math.max(-1, options.pan ?? 0))
      gain.connect(panner)
      tail = panner
    }
    tail.connect(master)

    this.liveVoices += 1
    source.onended = () => {
      this.liveVoices = Math.max(0, this.liveVoices - 1)
      gain.disconnect()
    }
    source.start()
  }

  get isUnlocked(): boolean {
    return this.unlocked
  }

  play(event: SoundEvent): void {
    const ctx = this.ctx
    const master = this.master
    // Before the first gesture, or while muted, there is nothing worth
    // scheduling — a muted play would still burn nodes for a silent sound.
    if (!ctx || !master || this.muted_ || this.volume_ === 0) return

    // Widened on purpose: `satisfies` keeps a distinct literal type per entry,
    // which the shared scheduling path below has no use for.
    const spec: SfxSpec = SFX_BANK[event]
    if (!spec) return

    const now = this.now()
    const last = this.lastPlayedAt.get(event)
    const throttle = spec.throttleMs ?? DEFAULT_THROTTLE_MS
    if (last !== undefined && now - last < throttle) return
    if (this.liveLayers + spec.layers.length > MAX_LIVE_LAYERS) return
    this.lastPlayedAt.set(event, now)

    // A context suspended by a tab switch never advances currentTime, so every
    // later sound would be scheduled in the past and play as a click.
    this.resumeContext()

    for (const layer of spec.layers) this.renderLayer(layer, ctx, master)
  }

  get currentTrack(): MusicTrack {
    return this.track
  }

  // Switches the score. Scenes call this on the transitions that matter — a
  // round starting, the lobby coming back — and nothing else: the scoreboard
  // deliberately says nothing, so the round's track carries on under it.
  playMusic(track: MusicTrack): void {
    if (track === this.track && this.musicWanted) {
      // Already the right track; make sure it is actually running (it may have
      // been stopped by a mute, or refused by autoplay before the first click).
      this.startMusic()
      return
    }
    const previous = this.musicElements.get(this.track)
    if (previous && track !== this.track) {
      previous.pause()
      // A race starts at the top of its track, so the round's music is rewound
      // when it is left; the lobby's is not, and picks up where it stopped.
      if (this.track === 'round') previous.currentTime = 0
    }
    this.track = track
    this.startMusic()
  }

  startMusic(): void {
    this.musicWanted = true
    if (!this.unlocked || this.muted_) return
    const music = this.musicFor(this.track)
    if (!music) return
    music.loop = true
    music.volume = this.effectiveVolume * MUSIC_MIX
    // Autoplay can still be refused (an unlock triggered by a keypress on some
    // browsers); the next unmute or scene click retries, so a rejection here is
    // not worth surfacing.
    void music.play().catch(() => undefined)
  }

  stopMusic(): void {
    this.musicWanted = false
    for (const music of this.musicElements.values()) music.pause()
  }

  destroy(): void {
    for (const music of this.musicElements.values()) music.pause()
    this.musicElements.clear()
    this.runLoop?.source.stop()
    this.runLoop?.lfo.stop()
    this.runLoop = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.master = null
  }

  private musicFor(track: MusicTrack): HTMLAudioElement | null {
    const existing = this.musicElements.get(track)
    if (existing) return existing
    const created = this.createMusic(track)
    if (created) this.musicElements.set(track, created)
    return created
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.effectiveVolume
    // Every element, not just the current one: a track paused mid-switch still
    // has to come back at the right level.
    for (const music of this.musicElements.values()) {
      music.volume = this.effectiveVolume * MUSIC_MIX
    }
    const current = this.musicElements.get(this.track)
    if (!current) return
    // Pausing rather than leaving a silent stream running keeps a muted tab
    // from decoding audio for nothing.
    if (this.effectiveVolume === 0) current.pause()
    else if (this.musicWanted) void current.play().catch(() => undefined)
  }

  private resumeContext(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined)
  }

  private renderLayer(layer: SfxLayer, ctx: AudioContext, master: GainNode): void {
    const start = ctx.currentTime + (layer.delay ?? 0)
    const end = start + layer.duration

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.linearRampToValueAtTime(layer.gain, start + layer.attack)
    // Exponential ramps cannot reach 0, hence the near-silent floor.
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)

    const source: AudioScheduledSourceNode =
      layer.kind === 'noise'
        ? this.makeNoiseSource(ctx)
        : this.makeToneSource(ctx, layer, start, end)

    let tail: AudioNode = source
    if (layer.filter) {
      const filter = ctx.createBiquadFilter()
      filter.type = layer.filter.type
      filter.Q.value = layer.filter.q ?? 1
      filter.frequency.setValueAtTime(layer.filter.startFreq, start)
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, layer.filter.endFreq), end)
      source.connect(filter)
      tail = filter
    }
    tail.connect(envelope)
    envelope.connect(master)

    this.liveLayers += 1
    source.onended = () => {
      this.liveLayers = Math.max(0, this.liveLayers - 1)
      envelope.disconnect()
    }
    source.start(start)
    source.stop(end)
  }

  private makeToneSource(
    ctx: AudioContext,
    layer: SfxLayer,
    start: number,
    end: number,
  ): OscillatorNode {
    const osc = ctx.createOscillator()
    osc.type = layer.wave ?? 'square'
    osc.frequency.setValueAtTime(Math.max(1, layer.startFreq), start)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.endFreq), end)
    return osc
  }

  // One second of white noise, generated once and replayed at random offsets
  // by the layers that need it — cheaper than filling a buffer per shot.
  private makeNoiseSource(ctx: AudioContext): AudioBufferSourceNode {
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate)
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buffer
    }
    const source = ctx.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    return source
  }

  private loadSettings(): PersistedSettings {
    const fallback: PersistedSettings = { muted: false, volume: DEFAULT_VOLUME }
    try {
      const raw = this.storage?.getItem(SETTINGS_KEY)
      if (!raw) return fallback
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>
      return {
        muted: parsed.muted === true,
        volume:
          typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
            ? Math.min(1, Math.max(0, parsed.volume))
            : DEFAULT_VOLUME,
      }
    } catch {
      // Unreadable or corrupt settings are not worth a broken boot: localStorage
      // throws in private-mode Safari, and a hand-edited value can be anything.
      return fallback
    }
  }

  private saveSettings(): void {
    try {
      this.storage?.setItem(
        SETTINGS_KEY,
        JSON.stringify({ muted: this.muted_, volume: this.volume_ }),
      )
    } catch {
      // Best-effort, same reasoning as loadSettings.
    }
  }
}

function defaultCreateContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? new Ctor() : null
}

function defaultCreateMusic(track: MusicTrack): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null
  const el = document.createElement('audio')
  // 'auto' on the lobby track only: the round's music is created the moment a
  // round starts, and buffering it earlier would compete with the assets the
  // loading screen is fetching.
  el.preload = track === 'lobby' ? 'auto' : 'metadata'
  el.loop = true
  for (const { src, type } of MUSIC_TRACKS[track]) {
    const source = document.createElement('source')
    source.src = src
    source.type = type
    el.appendChild(source)
  }
  return el
}

async function defaultFetchSample(url: string): Promise<ArrayBuffer> {
  const response = await window.fetch(url)
  if (!response.ok) throw new Error(`audio sample ${url}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

function defaultStorage(): AudioStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// One game runs per page, and the UI widgets (Button, IconButton, the mobile
// controls) are built far from the Game instance — a module-level instance
// spares every one of them an injected dependency they would only forward.
// `Game` re-exposes it as `game.audio` so scenes keep reading like the rest of
// the systems.
export const audio = new AudioManager()
