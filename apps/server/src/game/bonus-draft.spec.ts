import { BONUS_IDS, BONUS_OFFER_SIZE, type BonusId } from '@hips/shared'

import { BonusDraft } from './bonus-draft'

// Always-zero RNG: every draw takes the first remaining card, so an offer is
// deterministically the first three ids in BONUS_IDS order.
const zeroRng = () => 0

describe('BonusDraft', () => {
  it('offers three distinct bonuses per player', () => {
    const draft = new BonusDraft(['a', 'b'], Math.random, BONUS_IDS)
    for (const id of ['a', 'b']) {
      const offer = draft.offerFor(id)!
      expect(offer).toHaveLength(BONUS_OFFER_SIZE)
      expect(new Set(offer).size).toBe(BONUS_OFFER_SIZE)
      for (const bonus of offer) expect(BONUS_IDS).toContain(bonus)
    }
  })

  it('draws from the catalogue in order under a zero RNG', () => {
    const draft = new BonusDraft(['a'], zeroRng, BONUS_IDS)
    expect(draft.offerFor('a')).toEqual(BONUS_IDS.slice(0, BONUS_OFFER_SIZE))
  })

  it('returns null for a player that is not in the draft', () => {
    const draft = new BonusDraft(['a'], zeroRng, BONUS_IDS)
    expect(draft.offerFor('ghost')).toBeNull()
  })

  it('rejects a bonus that was not offered', () => {
    const draft = new BonusDraft(['a'], zeroRng, BONUS_IDS)
    const notOffered = BONUS_IDS[BONUS_IDS.length - 1]!
    expect(draft.pick('a', notOffered)).toBe(false)
    expect(draft.pickedIds()).toEqual([])
  })

  it('rejects a second pick from the same player', () => {
    const draft = new BonusDraft(['a'], zeroRng, BONUS_IDS)
    const offer = draft.offerFor('a')!
    expect(draft.pick('a', offer[0]!)).toBe(true)
    expect(draft.pick('a', offer[1]!)).toBe(false)
  })

  it('is complete only once every player has picked', () => {
    const draft = new BonusDraft(['a', 'b'], zeroRng, BONUS_IDS)
    draft.pick('a', draft.offerFor('a')![0]!)
    expect(draft.isComplete()).toBe(false)
    draft.pick('b', draft.offerFor('b')![0]!)
    expect(draft.isComplete()).toBe(true)
  })

  it('auto-picks a card from the offer for a player who never picked', () => {
    const draft = new BonusDraft(['a', 'b'], zeroRng, BONUS_IDS)
    const chosen = draft.offerFor('a')![2]!
    draft.pick('a', chosen)
    const picks = draft.resolve()
    expect(picks.get('a')).toBe(chosen)
    expect(draft.offerFor('b')).toContain(picks.get('b'))
  })

  it('forgets a disconnected player, unblocking completion', () => {
    const draft = new BonusDraft(['a', 'b'], zeroRng, BONUS_IDS)
    draft.pick('a', draft.offerFor('a')![0]!)
    expect(draft.isComplete()).toBe(false)
    draft.forget('b')
    expect(draft.isComplete()).toBe(true)
    expect(draft.offerFor('b')).toBeNull()
  })
})

// The host picks which bonuses a round may draw from, so the pool can be
// smaller than the catalogue — and smaller than a full offer.
describe('BonusDraft — restricted pool', () => {
  it('never offers a bonus outside the pool', () => {
    const pool: BonusId[] = ['bomb', 'vest', 'sprint', 'horde']
    const draft = new BonusDraft(['a'], Math.random, pool)
    for (const bonus of draft.offerFor('a')!) expect(pool).toContain(bonus)
  })

  it('shrinks the offer to the pool when the pool is smaller than three', () => {
    const pool: BonusId[] = ['bomb', 'horde']
    const draft = new BonusDraft(['a'], Math.random, pool)
    const offer = draft.offerFor('a')!
    expect(offer).toHaveLength(2)
    expect(new Set(offer).size).toBe(2)
  })

  it('offers the single remaining bonus to everyone when the pool holds one', () => {
    const draft = new BonusDraft(['a', 'b'], Math.random, ['horde'])
    expect(draft.offerFor('a')).toEqual(['horde'])
    expect(draft.offerFor('b')).toEqual(['horde'])
  })

  it('auto-picks from the restricted pool on resolve', () => {
    const draft = new BonusDraft(['a'], Math.random, ['runaway', 'horde'])
    const picks = draft.resolve()
    expect(['runaway', 'horde']).toContain(picks.get('a'))
  })
})
