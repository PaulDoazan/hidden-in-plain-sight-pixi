import type { BonusId } from '@hips/shared'

// Every sound effect is described as data rather than baked into a .wav file.
// Two reasons: no binary asset to license, host or preload (the whole bank
// weighs a few hundred bytes of TypeScript), and the recipes stay readable and
// tweakable — the chiptune-ish result also matches the game's pixel look.
// AudioManager is what turns a spec into WebAudio nodes.

export interface SfxLayer {
  // 'tone' is an oscillator (pitched), 'noise' a white-noise buffer (percussive).
  kind: 'tone' | 'noise'
  wave?: OscillatorType
  // Pitch glide over the layer's lifetime. Equal values mean a steady pitch.
  // Ignored for noise layers, which are shaped by `filter` instead.
  startFreq: number
  endFreq: number
  // Seconds. `attack` is how long the layer takes to reach `gain`; the rest of
  // the duration is an exponential decay down to silence.
  duration: number
  attack: number
  gain: number
  // Seconds after the trigger. Lets one spec describe an arpeggio or a
  // two-stage impact without any scheduling code at the call site.
  delay?: number
  // Sweeping band, mostly used to turn flat noise into a whoosh or a thud.
  filter?: {
    type: BiquadFilterType
    startFreq: number
    endFreq: number
    q?: number
  }
}

export interface SfxSpec {
  layers: SfxLayer[]
  // Minimum gap between two plays of the same effect. A bomb kills dozens of
  // bots at once and each one emits its own `player-killed`, so without this
  // the same sample would stack into a wall of noise (and clip the master).
  throttleMs?: number
}

export type SoundEvent = keyof typeof SFX_BANK

// Shorthand helpers keep the bank itself readable as a table of sounds.
const tone = (
  startFreq: number,
  endFreq: number,
  duration: number,
  gain: number,
  wave: OscillatorType = 'square',
  delay = 0,
): SfxLayer => ({
  kind: 'tone',
  wave,
  startFreq,
  endFreq,
  duration,
  attack: 0.005,
  gain,
  delay,
})

const blip = (freq: number, delay: number, gain = 0.16, wave: OscillatorType = 'square'): SfxLayer =>
  tone(freq, freq, 0.1, gain, wave, delay)

const noise = (
  duration: number,
  gain: number,
  filter: SfxLayer['filter'],
  delay = 0,
  attack = 0.002,
): SfxLayer => ({
  kind: 'noise',
  startFreq: 0,
  endFreq: 0,
  duration,
  attack,
  gain,
  delay,
  filter,
})

export const SFX_BANK = {
  // --- UI -----------------------------------------------------------------
  'ui-click': { layers: [tone(880, 640, 0.06, 0.14)], throttleMs: 40 },
  'ui-cancel': { layers: [tone(440, 220, 0.1, 0.13)], throttleMs: 40 },
  'ui-error': {
    layers: [tone(200, 150, 0.16, 0.18, 'sawtooth'), tone(150, 90, 0.26, 0.18, 'sawtooth', 0.14)],
  },

  // --- Round lifecycle -----------------------------------------------------
  'game-start': {
    layers: [
      blip(523, 0),
      blip(659, 0.09),
      blip(784, 0.18),
      tone(1046, 1046, 0.32, 0.14, 'triangle', 0.27),
      tone(110, 220, 0.5, 0.1, 'sine'),
    ],
  },
  'finish-line': {
    layers: [
      noise(0.45, 0.22, { type: 'bandpass', startFreq: 400, endFreq: 3600, q: 1.4 }),
      tone(1318, 1318, 0.5, 0.13, 'triangle', 0.1),
      tone(1976, 1976, 0.4, 0.09, 'triangle', 0.18),
    ],
  },
  victory: {
    layers: [
      blip(523, 0, 0.15, 'triangle'),
      blip(659, 0.11, 0.15, 'triangle'),
      blip(784, 0.22, 0.15, 'triangle'),
      tone(1046, 1046, 0.6, 0.17, 'triangle', 0.33),
      tone(1568, 1568, 0.6, 0.09, 'square', 0.33),
    ],
  },
  defeat: {
    layers: [
      tone(392, 392, 0.22, 0.15, 'sawtooth'),
      tone(330, 330, 0.22, 0.15, 'sawtooth', 0.2),
      tone(262, 262, 0.28, 0.15, 'sawtooth', 0.4),
      tone(196, 140, 0.7, 0.16, 'sawtooth', 0.62),
    ],
  },

  // --- Combat --------------------------------------------------------------
  shot: {
    layers: [
      noise(0.14, 0.34, { type: 'highpass', startFreq: 2400, endFreq: 500 }),
      tone(240, 60, 0.12, 0.2, 'square'),
    ],
    throttleMs: 35,
  },
  'shot-hit': {
    layers: [
      noise(0.14, 0.34, { type: 'highpass', startFreq: 2400, endFreq: 500 }),
      tone(240, 60, 0.12, 0.2, 'square'),
      noise(0.26, 0.26, { type: 'lowpass', startFreq: 1200, endFreq: 200 }, 0.04),
      tone(180, 45, 0.3, 0.2, 'sine', 0.04),
    ],
    throttleMs: 35,
  },
  // A zombie — bot or player — goes down somewhere on the field.
  death: {
    layers: [tone(320, 70, 0.45, 0.16, 'sawtooth'), noise(0.3, 0.12, { type: 'lowpass', startFreq: 900, endFreq: 150 })],
    throttleMs: 120,
  },
  // Louder and longer: this one is the local player's own death.
  'own-death': {
    layers: [
      tone(260, 40, 0.9, 0.24, 'sawtooth'),
      noise(0.5, 0.2, { type: 'lowpass', startFreq: 1400, endFreq: 120 }),
      tone(130, 30, 1.1, 0.14, 'sine', 0.1),
    ],
  },
  // Reward blip that doubles the "+1 balle" flash.
  'kill-reward': {
    layers: [blip(1046, 0, 0.13, 'triangle'), blip(1568, 0.08, 0.13, 'triangle')],
  },

  // --- Draft ---------------------------------------------------------------
  'draft-start': {
    layers: [
      tone(300, 900, 0.4, 0.12, 'sine'),
      tone(1200, 1200, 0.35, 0.08, 'triangle', 0.16),
    ],
  },
  'card-pick': {
    layers: [tone(660, 990, 0.12, 0.16, 'triangle'), tone(1320, 1320, 0.16, 0.08, 'triangle', 0.08)],
  },
  'bonus-granted': {
    layers: [blip(523, 0, 0.12, 'triangle'), blip(784, 0.08, 0.12, 'triangle'), blip(1046, 0.16, 0.12, 'triangle')],
  },

  // --- One signature per bonus --------------------------------------------
  // Cheap to do — each is a handful of layers — and it lets a player tell what
  // just went off in the room without reading the kill feed.
  'bonus-bomb': {
    layers: [
      noise(0.9, 0.5, { type: 'lowpass', startFreq: 1800, endFreq: 60 }, 0, 0.004),
      tone(90, 25, 0.8, 0.3, 'sine'),
      noise(0.35, 0.22, { type: 'highpass', startFreq: 300, endFreq: 2600 }, 0.02),
    ],
  },
  'bonus-vest': {
    layers: [
      tone(1400, 900, 0.5, 0.16, 'triangle'),
      tone(700, 520, 0.55, 0.12, 'sine', 0.03),
      noise(0.12, 0.14, { type: 'bandpass', startFreq: 2000, endFreq: 4000, q: 3 }),
    ],
  },
  'bonus-skin-swap': {
    layers: [
      tone(400, 900, 0.16, 0.14, 'sine'),
      tone(900, 400, 0.16, 0.14, 'sine', 0.16),
      tone(400, 1100, 0.2, 0.12, 'sine', 0.32),
    ],
  },
  'bonus-extra-life': {
    layers: [
      blip(392, 0, 0.13, 'triangle'),
      blip(523, 0.1, 0.13, 'triangle'),
      blip(659, 0.2, 0.13, 'triangle'),
      tone(784, 784, 0.5, 0.15, 'triangle', 0.3),
    ],
  },
  'bonus-magazine': {
    layers: [
      noise(0.07, 0.3, { type: 'bandpass', startFreq: 1800, endFreq: 1200, q: 6 }),
      noise(0.09, 0.3, { type: 'bandpass', startFreq: 1200, endFreq: 900, q: 6 }, 0.11),
      tone(160, 110, 0.12, 0.12, 'square', 0.11),
    ],
  },
  'bonus-sprint': {
    layers: [
      noise(0.4, 0.26, { type: 'highpass', startFreq: 300, endFreq: 3200 }, 0, 0.08),
      tone(300, 1200, 0.35, 0.1, 'sine'),
    ],
  },
  'bonus-runaway': {
    layers: [
      noise(0.45, 0.26, { type: 'highpass', startFreq: 3200, endFreq: 300 }, 0, 0.06),
      tone(1200, 260, 0.4, 0.1, 'sine'),
    ],
  },
  'bonus-horde': {
    layers: [
      tone(80, 55, 0.9, 0.22, 'sawtooth'),
      tone(120, 90, 0.9, 0.14, 'square', 0.05),
      noise(0.7, 0.16, { type: 'lowpass', startFreq: 700, endFreq: 200 }),
    ],
  },
} satisfies Record<string, SfxSpec>

// --- Zombie voices ---------------------------------------------------------
// The one family of sounds that is *not* synthesised: a throat is full of
// noisy formants that a couple of oscillators cannot fake, and the crowd is
// what sells the horde. These are real recordings, both packs released under
// CC0 on OpenGameArt (see apps/client/public/assets/audio/CREDITS.md), trimmed,
// loudness-matched and re-encoded as small mono MP3s — MP3 because it is the
// one format `decodeAudioData` accepts in every browser, Safari included.
export type ZombieVoiceState = 'idle' | 'walk' | 'run' | 'death'

// Several takes per state: a horde that repeats one groan reads as a glitch.
export const ZOMBIE_VOICES: Record<ZombieVoiceState, string[]> = {
  idle: ['idle-1', 'idle-2', 'idle-3'],
  walk: ['walk-1', 'walk-2', 'walk-3'],
  run: ['run-1', 'run-2', 'run-3'],
  death: ['death-1', 'death-2', 'death-3'],
}

export const ZOMBIE_VOICE_SAMPLES: string[] = Object.values(ZOMBIE_VOICES).flat()

export function zombieVoiceUrl(sample: string): string {
  return `/assets/audio/zombie/${sample}.mp3`
}

// `random` is passed in so the callers that must stay deterministic in tests
// can hand over their own source.
export function pickZombieVoice(state: ZombieVoiceState, random: () => number): string {
  const takes = ZOMBIE_VOICES[state]
  return takes[Math.min(takes.length - 1, Math.floor(random() * takes.length))]!
}

// Fallback for a bonus that has no signature of its own yet — a new BonusId
// added server-side must never make the client throw mid-round.
const BONUS_FALLBACK: SoundEvent = 'bonus-granted'

export function bonusSoundEvent(bonusId: BonusId): SoundEvent {
  const key = `bonus-${bonusId}`
  return key in SFX_BANK ? (key as SoundEvent) : BONUS_FALLBACK
}
