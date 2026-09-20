import { RoomRegistry } from './room-registry.service'

describe('RoomRegistry', () => {
  let registry: RoomRegistry

  beforeEach(() => {
    registry = new RoomRegistry()
  })

  it('issues a fresh room with a 6-character uppercase alphanumeric code', () => {
    const { code, room } = registry.create()
    expect(code).toMatch(/^[A-Z0-9]{6}$/)
    expect(room).toBeDefined()
    expect(registry.size).toBe(1)
  })

  it('returns the same room instance for lookups by code (case-insensitive)', () => {
    const { code, room } = registry.create()
    expect(registry.get(code)).toBe(room)
    expect(registry.get(code.toLowerCase())).toBe(room)
  })

  it('returns undefined for unknown codes', () => {
    expect(registry.get('ZZZZZZ')).toBeUndefined()
  })

  it('emits distinct codes across rapid successive creates', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 50; i++) codes.add(registry.create().code)
    expect(codes.size).toBe(50)
  })

  it('forgets a room after remove()', () => {
    const { code } = registry.create()
    registry.remove(code)
    expect(registry.get(code)).toBeUndefined()
    expect(registry.size).toBe(0)
  })
})
