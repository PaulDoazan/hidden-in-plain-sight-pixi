import { ARRIVAL_LINE_X, SERVER_TICK_HZ, WALK_SPEED, RUN_SPEED } from '@hips/shared'

import { BULLETS_PER_PLAYER, GameRoomService } from './game-room.service'

describe('GameRoomService — lobby', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
  })

  it('makes the first connecting socket the host', () => {
    room.addPlayer('a')
    expect(room.snapshotLobby()).toEqual({
      players: [{ id: 'a', isHost: true }],
      status: 'waiting',
    })
  })

  it('keeps the oldest connection as host when others join', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    expect(room.snapshotLobby().players).toEqual([
      { id: 'a', isHost: true },
      { id: 'b', isHost: false },
    ])
  })

  it('promotes the next-oldest socket when the host leaves', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.removePlayer('a')
    expect(room.snapshotLobby().players).toEqual([
      { id: 'b', isHost: true },
      { id: 'c', isHost: false },
    ])
  })

  it('reports the room as empty after everyone leaves', () => {
    room.addPlayer('a')
    room.removePlayer('a')
    expect(room.snapshotLobby()).toEqual({ players: [], status: 'waiting' })
  })
})

describe('GameRoomService — start', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
  })

  it('refuses start while there are no players', () => {
    expect(room.start('nobody')).toBeNull()
  })

  it('refuses start from a non-host', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    expect(room.start('b')).toBeNull()
    expect(room.snapshotLobby().status).toBe('waiting')
  })

  it('spawns each connected player at the start band when host starts', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    const result = room.start('a')
    expect(result).not.toBeNull()
    expect(result!.players).toHaveLength(2)
    for (const p of result!.players) {
      expect(p.x).toBeGreaterThanOrEqual(30)
      expect(p.x).toBeLessThanOrEqual(70)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(886)
      expect(p.animation).toBe('idle')
      expect(p.isAlive).toBe(true)
      expect(p.bulletsRemaining).toBe(BULLETS_PER_PLAYER)
    }
    expect(room.snapshotLobby().status).toBe('running')
  })

  it('assigns zombie types in a stable cycle', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.addPlayer('d')
    const result = room.start('a')!
    expect(result.players.map((p) => p.type)).toEqual(['man', 'woman', 'wild', 'man'])
  })

  it('refuses a second start call once the room is running', () => {
    room.addPlayer('a')
    room.start('a')
    expect(room.start('a')).toBeNull()
    expect(room.snapshotLobby().status).toBe('running')
  })
})

describe('GameRoomService — movement', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.start('a')
  })

  it('does not move a player whose space is not held', () => {
    const before = room.snapshotState().players[0]!
    room.tick()
    const after = room.snapshotState().players[0]!
    expect(after.x).toBe(before.x)
    expect(after.animation).toBe('idle')
  })

  it('walks a player when space is held', () => {
    room.applyInput('a', {
      keys: { space: true, shift: false },
      pointer: { x: 0, y: 0 },
    })
    const before = room.snapshotState().players[0]!.x
    room.tick()
    const after = room.snapshotState().players[0]!
    expect(after.x).toBeCloseTo(before + WALK_SPEED * (60 / SERVER_TICK_HZ), 5)
    expect(after.animation).toBe('walk')
  })

  it('runs a player when shift+space is held', () => {
    room.applyInput('a', {
      keys: { space: true, shift: true },
      pointer: { x: 0, y: 0 },
    })
    const before = room.snapshotState().players[0]!.x
    room.tick()
    const after = room.snapshotState().players[0]!
    expect(after.x).toBeCloseTo(before + RUN_SPEED * (60 / SERVER_TICK_HZ), 5)
    expect(after.animation).toBe('run')
  })

  it('does not move a dead player', () => {
    const id = 'a'
    // Force-kill via internal state for this test.
    room.killForTest(id)
    room.applyInput(id, {
      keys: { space: true, shift: false },
      pointer: { x: 0, y: 0 },
    })
    const before = room.snapshotState().players[0]!.x
    room.tick()
    expect(room.snapshotState().players[0]!.x).toBe(before)
  })
})

describe('GameRoomService — fire', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
  })

  it('returns a miss when the pointer hits no one', () => {
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    const result = room.fire('a', { x: a.x + 1000, y: a.y + 1000 })
    expect(result).toEqual({
      shooterId: 'a',
      origin: { x: a.x + 1000, y: a.y + 1000 },
      hit: null,
    })
  })

  it('marks the target dead on a hit and decrements the bullet', () => {
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(result!.hit).toEqual({ targetId: 'b' })
    const after = room.snapshotState()
    expect(after.players.find((p) => p.id === 'b')!.isAlive).toBe(false)
    expect(after.players.find((p) => p.id === 'b')!.animation).toBe('die')
    expect(after.players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(
      BULLETS_PER_PLAYER - 1,
    )
  })

  it('refuses to shoot oneself', () => {
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    const result = room.fire('a', { x: a.x, y: a.y - 10 })
    expect(result!.hit).toBeNull()
  })

  it('refuses to fire when no bullets remain', () => {
    // Force-empty the magazine so this test stays meaningful regardless of
    // BULLETS_PER_PLAYER (kept high in dev mode for stress-testing fire sync).
    room.setBulletsForTest('a', 0)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    expect(room.fire('a', { x: b.x, y: b.y - 10 })).toBeNull()
  })

  it('still lets a dead shooter fire (per game design)', () => {
    room.killForTest('a')
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(result).not.toBeNull()
    expect(result!.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(false)
  })
})

describe('GameRoomService — win condition', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
  })

  it('returns null from tickAndCheckWinner while no one has crossed', () => {
    expect(room.tickAndCheckWinner()).toBeNull()
  })

  it('declares the player who crosses the arrival line as winner', () => {
    // Teleport 'a' just past the line so the next tick triggers the check.
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    const winner = room.tickAndCheckWinner()
    expect(winner).toEqual({ winnerId: 'a' })
    expect(room.snapshotLobby().status).toBe('ended')
  })

  it('ignores dead players for the arrival check', () => {
    room.killForTest('a')
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    expect(room.tickAndCheckWinner()).toBeNull()
  })
})

describe('GameRoomService — disconnect during running', () => {
  it('removes the player from the snapshot', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
    room.removePlayer('b')
    const ids = room.snapshotState().players.map((p) => p.id)
    expect(ids).toEqual(['a'])
  })

  it('resets the room to waiting when the last player leaves', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    room.start('a')
    expect(room.snapshotLobby().status).toBe('running')
    room.removePlayer('a')
    expect(room.snapshotLobby().status).toBe('waiting')
    expect(room.isEmpty()).toBe(true)
  })

  it('resets the room to waiting after an ended game when everyone leaves', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    room.start('a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    expect(room.snapshotLobby().status).toBe('ended')
    room.removePlayer('a')
    expect(room.snapshotLobby().status).toBe('waiting')
  })
})

describe('GameRoomService — replay', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
  })

  it('refuses replay from a non-host', () => {
    expect(room.replay('b')).toBe(false)
  })

  it('refuses replay while not in ended state', () => {
    const fresh = new GameRoomService()
    fresh.addPlayer('a')
    expect(fresh.replay('a')).toBe(false)
  })

  it('resets the room to waiting on host replay', () => {
    expect(room.replay('a')).toBe(true)
    expect(room.snapshotLobby().status).toBe('waiting')
    expect(room.snapshotState().players).toHaveLength(0)
  })
})
