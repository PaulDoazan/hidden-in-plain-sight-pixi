import { Injectable } from '@nestjs/common'
import type {
  GameStartedPayload,
  LobbyStatePayload,
  PlayerState,
  RoomStatus,
  ZombieType,
} from '@hips/shared'
import {
  ARRIVAL_LINE_X,
  SPAWN_BAND_WIDTH,
  SPAWN_BAND_X,
  WORLD_HEIGHT,
} from '@hips/shared'

const TYPES: ZombieType[] = ['man', 'woman', 'wild']
const BULLETS_PER_PLAYER = 1

@Injectable()
export class GameRoomService {
  private readonly playerOrder: string[] = []
  private readonly players = new Map<string, PlayerState>()
  private status: RoomStatus = 'waiting'

  addPlayer(id: string): void {
    if (this.playerOrder.includes(id)) return
    this.playerOrder.push(id)
  }

  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
    this.players.delete(id)
  }

  snapshotLobby(): LobbyStatePayload {
    return {
      players: this.playerOrder.map((id, i) => ({ id, isHost: i === 0 })),
      status: this.status,
    }
  }

  start(requesterId: string): GameStartedPayload | null {
    if (this.status !== 'waiting') return null
    if (this.playerOrder.length === 0) return null
    if (this.playerOrder[0] !== requesterId) return null

    this.players.clear()
    this.playerOrder.forEach((id, i) => {
      this.players.set(id, this.spawnPlayer(id, i))
    })
    this.status = 'running'
    return {
      players: [...this.players.values()],
      arrivalLineX: ARRIVAL_LINE_X,
    }
  }

  private spawnPlayer(id: string, index: number): PlayerState {
    return {
      id,
      type: TYPES[index % TYPES.length]!,
      x: SPAWN_BAND_X + Math.random() * SPAWN_BAND_WIDTH,
      // Stagger Y so two players don't perfectly overlap on spawn.
      y: WORLD_HEIGHT * (0.3 + ((index * 0.13) % 0.6)) + 100,
      animation: 'idle',
      isAlive: true,
      bulletsRemaining: BULLETS_PER_PLAYER,
    }
  }
}
