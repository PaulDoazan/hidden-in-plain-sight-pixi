import { Injectable } from '@nestjs/common'
import type { LobbyStatePayload, RoomStatus } from '@hips/shared'

@Injectable()
export class GameRoomService {
  private readonly playerOrder: string[] = []
  private status: RoomStatus = 'waiting'

  addPlayer(id: string): void {
    if (this.playerOrder.includes(id)) return
    this.playerOrder.push(id)
  }

  removePlayer(id: string): void {
    const idx = this.playerOrder.indexOf(id)
    if (idx >= 0) this.playerOrder.splice(idx, 1)
  }

  snapshotLobby(): LobbyStatePayload {
    return {
      players: this.playerOrder.map((id, i) => ({ id, isHost: i === 0 })),
      status: this.status,
    }
  }
}
