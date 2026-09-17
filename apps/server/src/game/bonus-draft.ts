import type { BonusId } from '@hips/shared'
import { BONUS_IDS, BONUS_OFFER_SIZE } from '@hips/shared'

// Owns one round's draw: which cards each player was offered and what they
// picked. Independent of the room so it can be unit-tested on its own, and so
// GameRoomService keeps a single field instead of three maps.
export class BonusDraft {
  private readonly offers = new Map<string, BonusId[]>()
  private readonly picks = new Map<string, BonusId>()

  constructor(
    playerIds: string[],
    private readonly rng: () => number,
  ) {
    for (const id of playerIds) this.offers.set(id, this.drawOffer())
  }

  offerFor(playerId: string): BonusId[] | null {
    const offer = this.offers.get(playerId)
    return offer ? [...offer] : null
  }

  // Every offer, for the gateway to emit socket by socket.
  entries(): { playerId: string; offer: BonusId[] }[] {
    return [...this.offers].map(([playerId, offer]) => ({
      playerId,
      offer: [...offer],
    }))
  }

  // Rejects a bonus outside the player's own offer and any second pick, so a
  // hostile client can't draft a card it was never shown or swap later.
  pick(playerId: string, bonusId: BonusId): boolean {
    if (this.picks.has(playerId)) return false
    const offer = this.offers.get(playerId)
    if (!offer?.includes(bonusId)) return false
    this.picks.set(playerId, bonusId)
    return true
  }

  pickedIds(): string[] {
    return [...this.picks.keys()]
  }

  isComplete(): boolean {
    return this.picks.size === this.offers.size
  }

  forget(playerId: string): void {
    this.offers.delete(playerId)
    this.picks.delete(playerId)
  }

  // Closes the draft. Stragglers get a random card among the three they were
  // offered — not the first, which would make one bonus over-represented
  // every time a player goes AFK.
  resolve(): Map<string, BonusId> {
    for (const [playerId, offer] of this.offers) {
      if (this.picks.has(playerId)) continue
      this.picks.set(playerId, offer[Math.floor(this.rng() * offer.length)]!)
    }
    return new Map(this.picks)
  }

  // Draw without replacement so the three cards are always distinct. Offers
  // are independent between players: two players may be shown, and pick, the
  // same bonus.
  private drawOffer(): BonusId[] {
    const pool = [...BONUS_IDS]
    const offer: BonusId[] = []
    for (let i = 0; i < BONUS_OFFER_SIZE && pool.length > 0; i++) {
      offer.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!)
    }
    return offer
  }
}
