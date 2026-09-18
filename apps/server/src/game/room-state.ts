import type { BonusId, BotState, PlayerState } from '@hips/shared'

// Server-side player record. Everything beyond PlayerState is private to the
// room and stripped before a snapshot goes out: the drafted bonus must never
// reach other clients (that is the whole point of a secret pick).
export interface PlayerInternalState extends PlayerState {
  bonus: BonusId | null
  // Remaining uses. 1 for a bonus with an onActivate or onLethalHit hook,
  // 0 for a purely passive one.
  bonusCharges: number
  // Run-speed factor applied in tick(). 1 unless the Sprint bonus raised it.
  runMultiplier: number
}

// Bots wander on a timer; neither field belongs in a client snapshot.
export interface BotInternalState extends BotState {
  canMove: boolean
  countTick: number
  // Set by the Fuyard bonus: the bot drops out of the walk/idle cycle and
  // runs straight ahead for the rest of the round.
  forcedRun: boolean
}
