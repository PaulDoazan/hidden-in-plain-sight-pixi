import type { ZombieAnimation, ZombieType } from './index'

export interface PlayerState {
  id: string
  type: ZombieType
  x: number
  y: number
  animation: ZombieAnimation
  isAlive: boolean
  bulletsRemaining: number
}

export type RoomStatus = 'waiting' | 'running' | 'ended'

export interface InputPayload {
  keys: { space: boolean; shift: boolean }
  pointer: { x: number; y: number } // world coordinates
}

export interface FirePayload {
  pointer: { x: number; y: number } // world coordinates
}

export interface LobbyStatePayload {
  players: { id: string; isHost: boolean }[]
  status: RoomStatus
}

export interface GameStartedPayload {
  players: PlayerState[]
  arrivalLineX: number
}

export interface StatePayload {
  players: PlayerState[]
}

export interface ShotFiredPayload {
  shooterId: string
  origin: { x: number; y: number }
  hit: { targetId: string } | null
}

export interface PlayerKilledPayload {
  id: string
}

export interface GameEndedPayload {
  winnerId: string
}

export interface PlayerLeftPayload {
  id: string
}

// Client → Server
export interface ClientToServerEvents {
  start: () => void // host only, valid in `waiting`
  replay: () => void // host only, valid in `ended` — resets to `waiting`
  input: (payload: InputPayload) => void
  fire: (payload: FirePayload) => void
}

// Server → Client
export interface ServerToClientEvents {
  'lobby-state': (payload: LobbyStatePayload) => void
  'game-started': (payload: GameStartedPayload) => void
  state: (payload: StatePayload) => void // 30 Hz
  'shot-fired': (payload: ShotFiredPayload) => void
  'player-killed': (payload: PlayerKilledPayload) => void
  'game-ended': (payload: GameEndedPayload) => void
  'player-left': (payload: PlayerLeftPayload) => void
}
