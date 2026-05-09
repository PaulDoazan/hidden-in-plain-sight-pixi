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
