import { GameRoomService } from './game-room.service'

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
      expect(p.bulletsRemaining).toBe(1)
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
})
