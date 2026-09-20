import { Injectable } from '@nestjs/common'

import { GameRoomService } from './game-room.service'

// Code alphabet: uppercase letters + digits, minus visually ambiguous chars
// (0/O, 1/I/L). Six positions → 30^6 ≈ 729M codes; collisions are vanishingly
// rare but we still loop until unique.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

@Injectable()
export class RoomRegistry {
  private readonly rooms = new Map<string, GameRoomService>()

  create(): { code: string; room: GameRoomService } {
    let code: string
    do {
      code = generateCode()
    } while (this.rooms.has(code))
    const room = new GameRoomService()
    this.rooms.set(code, room)
    return { code, room }
  }

  get(code: string): GameRoomService | undefined {
    return this.rooms.get(code.toUpperCase())
  }

  remove(code: string): void {
    this.rooms.delete(code.toUpperCase())
  }

  // Test-only helper: reset the registry between tests so state from one
  // suite doesn't leak into the next when the same Nest provider singleton
  // would otherwise be reused.
  clearForTest(): void {
    this.rooms.clear()
  }

  get size(): number {
    return this.rooms.size
  }
}
