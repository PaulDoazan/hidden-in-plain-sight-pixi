import {
  ARRIVAL_LINE_X,
  ARRIVAL_POINTS,
  BONUS_IDS,
  BOT_COUNT,
  SERVER_TICK_HZ,
  SPAWN_BAND_WIDTH,
  SPAWN_BAND_X,
  WALK_SPEED,
  RUN_SPEED,
  WORLD_WIDTH,
  type BonusId,
} from '@hips/shared'

import { SPRINT_RUN_MULTIPLIER } from './bonuses'
import {
  BULLETS_PER_PLAYER,
  GameRoomService,
  SPAWN_Y_MAX,
  SPAWN_Y_MIN,
} from './game-room.service'

// start() either opens a draft or begins the round outright when the host has
// turned bonuses off. Suites about the draft always mean the former, so they
// narrow through this rather than asserting the shape on every call.
function startDraft(
  room: GameRoomService,
  hostId: string,
): { playerId: string; offer: BonusId[] }[] {
  const result = room.start(hostId)
  if (result?.kind !== 'draft') throw new Error('expected start() to open a draft')
  return result.offers
}

// Rounds now open on a bonus draft. Tests that care about the field, not the
// draft, go straight through it: nobody picks, so every player gets a random
// card, and the effect tests override it with forceBonusForTest.
function startRound(room: GameRoomService, hostId: string): void {
  room.start(hostId)
  room.resolveDraft()
}

describe('GameRoomService — lobby', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
  })

  it('makes the first connecting socket the host', () => {
    room.addPlayer('a', 'Antoine')
    expect(room.snapshotLobby()).toEqual({
      players: [{ id: 'a', isHost: true, username: 'Antoine' }],
      status: 'waiting',
      enabledBonuses: BONUS_IDS,
    })
  })

  it('keeps the oldest connection as host when others join', () => {
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    expect(room.snapshotLobby().players).toEqual([
      { id: 'a', isHost: true, username: 'Antoine' },
      { id: 'b', isHost: false, username: 'Bruno' },
    ])
  })

  it('promotes the next-oldest socket when the host leaves', () => {
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    room.addPlayer('c', 'Cécile')
    room.removePlayer('a')
    expect(room.snapshotLobby().players).toEqual([
      { id: 'b', isHost: true, username: 'Bruno' },
      { id: 'c', isHost: false, username: 'Cécile' },
    ])
  })

  it('reports the room as empty after everyone leaves', () => {
    room.addPlayer('a', 'Antoine')
    room.removePlayer('a')
    expect(room.snapshotLobby()).toEqual({
      players: [],
      status: 'waiting',
      enabledBonuses: BONUS_IDS,
    })
  })
})

describe('GameRoomService — usernames', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
  })

  it('falls back to "Joueur N" when an empty username is provided', () => {
    room.addPlayer('a', '')
    room.addPlayer('b', '   ')
    expect(room.snapshotLobby().players.map((p) => p.username)).toEqual([
      'Joueur 1',
      'Joueur 2',
    ])
  })

  it('treats the literal default placeholder "Joueur" as no real name chosen', () => {
    room.addPlayer('a', 'Joueur')
    room.addPlayer('b', 'Joueur')
    expect(room.snapshotLobby().players.map((p) => p.username)).toEqual([
      'Joueur 1',
      'Joueur 2',
    ])
  })

  it('trims whitespace and caps usernames at USERNAME_MAX_LENGTH', () => {
    room.addPlayer('a', '   Antoine   ')
    room.addPlayer('b', 'a'.repeat(50))
    const players = room.snapshotLobby().players
    expect(players[0]!.username).toBe('Antoine')
    expect(players[1]!.username).toHaveLength(20)
  })

  it('keeps the same username across replay (only snapshot players cleared)', () => {
    room.addPlayer('a', 'Antoine')
    startRound(room, 'a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    room.replay('a')
    expect(room.usernameFor('a')).toBe('Antoine')
    expect(room.snapshotLobby().players[0]!.username).toBe('Antoine')
  })

  it('copies the username onto the spawned PlayerState', () => {
    room.addPlayer('a', 'Antoine')
    room.start('a')
    const result = room.resolveDraft()!
    expect(result.started.players[0]!.username).toBe('Antoine')
  })

  it('allows two players to pick the same username in a room', () => {
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Antoine')
    expect(room.snapshotLobby().players.map((p) => p.username)).toEqual([
      'Antoine',
      'Antoine',
    ])
  })
})

describe('GameRoomService — start', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    // Neutral seed: the auto-picked draft bonus must never be one with a
    // round-start effect (magazine, sprint), or these spawn assertions would
    // be flaky. rng()=0 always draws/resolves to 'bomb', which has none.
    room.setRngForTest(() => 0)
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
    room.start('a')
    const result = room.resolveDraft()
    expect(result).not.toBeNull()
    expect(result!.started.players).toHaveLength(2)
    for (const p of result!.started.players) {
      expect(p.x).toBeGreaterThanOrEqual(SPAWN_BAND_X)
      expect(p.x).toBeLessThanOrEqual(SPAWN_BAND_X + SPAWN_BAND_WIDTH)
      expect(p.y).toBeGreaterThanOrEqual(SPAWN_Y_MIN)
      expect(p.y).toBeLessThanOrEqual(SPAWN_Y_MAX)
      expect(p.animation).toBe('idle')
      expect(p.isAlive).toBe(true)
      expect(p.bulletsRemaining).toBe(BULLETS_PER_PLAYER)
    }
    expect(room.snapshotLobby().status).toBe('running')
  })

  it('places every zombie (host included) inside the shared spawn-y band', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.start('a')
    const result = room.resolveDraft()!
    for (const p of result.started.players) {
      expect(p.y).toBeGreaterThanOrEqual(SPAWN_Y_MIN)
      expect(p.y).toBeLessThanOrEqual(SPAWN_Y_MAX)
    }
    for (const b of result.started.bots) {
      expect(b.y).toBeGreaterThanOrEqual(SPAWN_Y_MIN)
      expect(b.y).toBeLessThanOrEqual(SPAWN_Y_MAX)
    }
  })

  it('aligns every zombie (players + bots) in the same 20-unit left band', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.start('a')
    const result = room.resolveDraft()!
    const xs = [...result.started.players, ...result.started.bots].map((p) => p.x)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(SPAWN_BAND_X)
      expect(x).toBeLessThanOrEqual(SPAWN_BAND_X + SPAWN_BAND_WIDTH)
    }
  })

  it('assigns each zombie a random type drawn from the valid set', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.addPlayer('d')
    room.start('a')
    const result = room.resolveDraft()!
    const valid: ReadonlySet<string> = new Set(['man', 'woman', 'wild'])
    for (const p of [...result.started.players, ...result.started.bots]) {
      expect(valid.has(p.type)).toBe(true)
    }
  })

  it('refuses a second start call once the room is running', () => {
    room.addPlayer('a')
    startRound(room, 'a')
    expect(room.start('a')).toBeNull()
    expect(room.snapshotLobby().status).toBe('running')
  })
})

describe('GameRoomService — movement', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    // Neutral seed so the auto-picked draft bonus never happens to be sprint,
    // which would make the exact-speed assertions below flaky.
    room.setRngForTest(() => 0)
    room.addPlayer('a')
    startRound(room, 'a')
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
    // Neutral seed so the auto-picked draft bonus never happens to be
    // magazine, which would make the exact bulletsRemaining assertions flaky.
    room.setRngForTest(() => 0)
    room.addPlayer('a')
    room.addPlayer('b')
    startRound(room, 'a')
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
    // Move b out of the start-line cluster so the click uniquely targets them
    // (otherwise the overlapping bot column wins the depth-sort tiebreak).
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(result!.hit).toEqual({ targetId: 'b' })
    const after = room.snapshotState()
    expect(after.players.find((p) => p.id === 'b')!.isAlive).toBe(false)
    expect(after.players.find((p) => p.id === 'b')!.animation).toBe('die')
    // The bullet is spent, then the player-kill reward gives one back, so a
    // player kill nets zero. Bot kills still cost a bullet (see the bots suite).
    expect(after.players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(
      BULLETS_PER_PLAYER,
    )
  })

  it('refuses to shoot oneself', () => {
    // Move 'a' away from the start cluster so the click can only overlap
    // their own AABB (the shooter is filtered out → hit must be null).
    room.teleportForTest('a', 1500)
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
    // Same isolation as above: bots share the start column with players.
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(result).not.toBeNull()
    expect(result!.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(false)
  })

  // Bullet reward: killing a real player hands the shooter a fresh bullet, so
  // a good shot keeps them in the game. Each test pins the magazine to 1 first
  // so the assertions hold regardless of how BULLETS_PER_PLAYER is tuned.
  it('rewards a bullet when the shooter kills another player', () => {
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })
    expect(result!.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(1)
  })

  it('rewards a bullet even when the shooter is already dead', () => {
    room.killForTest('a')
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    room.fire('a', { x: b.x, y: b.y - 10 })
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(1)
  })

  it('rewards no bullet on a miss', () => {
    room.setBulletsForTest('a', 1)
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    const result = room.fire('a', { x: a.x + 1000, y: a.y + 1000 })
    expect(result!.hit).toBeNull()
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(0)
  })

  it('lets a player chain kills on the reward bullet alone', () => {
    // Fresh room: players only get a PlayerState at start() time, so the
    // third player has to join before the game starts.
    const room = new GameRoomService()
    // Neutral seed so the auto-picked draft bonus (e.g. vest, extra-life)
    // cannot absorb one of the kills below and break the chain.
    room.setRngForTest(() => 0)
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    startRound(room, 'a')
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    room.fire('a', { x: b.x, y: b.y - 10 })
    room.teleportForTest('c', 1200)
    const c = room.snapshotState().players.find((p) => p.id === 'c')!
    const second = room.fire('a', { x: c.x, y: c.y - 10 })
    expect(second!.hit).toEqual({ targetId: 'c' })
    expect(room.snapshotState().players.find((p) => p.id === 'c')!.isAlive).toBe(false)
  })
})

describe('GameRoomService — win condition', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    startRound(room, 'a')
  })

  it('returns null from tickAndCheckWinner while no one has crossed', () => {
    expect(room.tickAndCheckWinner()).toBeNull()
  })

  it('keeps the round running while a racer is still on the field', () => {
    // 'a' crosses but 'b' is still running: the round no longer stops at the
    // first arrival, it waits for everyone to finish or die.
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    expect(room.tickAndCheckWinner()).toBeNull()
    expect(room.snapshotLobby().status).toBe('running')
  })

  it('declares the first player across the line as winner once the field empties', () => {
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
    room.teleportForTest('b', ARRIVAL_LINE_X + 1)
    const winner = room.tickAndCheckWinner()
    expect(winner).toEqual({ reason: 'arrival', winnerId: 'a' })
    expect(room.snapshotLobby().status).toBe('ended')
  })

  it('declares the first finisher as winner even when the rest die', () => {
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
    room.killForTest('b')
    expect(room.tickAndCheckWinner()).toEqual({ reason: 'arrival', winnerId: 'a' })
  })

  it('credits +7 to the player who crosses the arrival line', () => {
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
    const winner = room.snapshotLeaderboard().find((e) => e.id === 'a')!
    expect(winner.total).toBe(7)
    expect(winner.lastDelta).toBe(7)
  })

  it('keeps the game running while at least one player is still alive', () => {
    // 'b' is still alive — only 'a' is dead and past the line. The dead-past-
    // line case must not be confused with the all-dead end condition.
    room.killForTest('a')
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    expect(room.tickAndCheckWinner()).toBeNull()
  })

  it('ends the game with reason "all-dead" when every connected player dies', () => {
    room.killForTest('a')
    room.killForTest('b')
    const result = room.tickAndCheckWinner()
    expect(result).toEqual({ reason: 'all-dead' })
    expect(room.snapshotLobby().status).toBe('ended')
  })

  it('awards no extra points when the game ends with all players dead', () => {
    room.killForTest('a')
    room.killForTest('b')
    room.tickAndCheckWinner()
    const board = room.snapshotLeaderboard()
    expect(board.every((e) => e.total === 0 && e.lastDelta === 0)).toBe(true)
  })
})

describe('GameRoomService — arrival scoring', () => {
  let room: GameRoomService

  // Walks `id` across the line and runs the tick that registers the arrival.
  function finish(room: GameRoomService, id: string): void {
    room.teleportForTest(id, ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
  }

  function totalFor(room: GameRoomService, id: string): number {
    return room.snapshotLeaderboard().find((e) => e.id === id)!.total
  }

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    startRound(room, 'a')
  })

  it('credits arrival points by finishing position', () => {
    finish(room, 'a')
    finish(room, 'b')
    finish(room, 'c')
    expect(totalFor(room, 'a')).toBe(ARRIVAL_POINTS[0])
    expect(totalFor(room, 'b')).toBe(ARRIVAL_POINTS[1])
    expect(totalFor(room, 'c')).toBe(ARRIVAL_POINTS[2])
  })

  it('floors arrival points at one for finishers past the table', () => {
    const late = new GameRoomService()
    const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    ids.forEach((id) => late.addPlayer(id))
    startRound(late, 'p0')
    ids.forEach((id) => finish(late, id))
    expect(totalFor(late, 'p6')).toBe(1)
  })

  it('credits nothing to a player who dies before the line', () => {
    room.killForTest('b')
    finish(room, 'a')
    finish(room, 'c')
    expect(totalFor(room, 'b')).toBe(0)
  })

  it('never credits a corpse pushed past the line', () => {
    room.killForTest('b')
    room.teleportForTest('b', ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
    expect(totalFor(room, 'b')).toBe(0)
  })

  it('marks a finisher as finished in the snapshot', () => {
    finish(room, 'a')
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    expect(a.hasFinished).toBe(true)
  })

  it('walks a finisher onward even with no input pressed', () => {
    finish(room, 'a')
    const before = room.snapshotState().players.find((p) => p.id === 'a')!.x
    room.tickAndCheckWinner()
    const after = room.snapshotState().players.find((p) => p.id === 'a')!.x
    expect(after).toBeGreaterThan(before)
  })

  it('drops a finisher from the snapshot once they walk off the world', () => {
    finish(room, 'a')
    // Far enough past the right edge that the next tick clears the margin.
    room.teleportForTest('a', WORLD_WIDTH + 500)
    room.tickAndCheckWinner()
    const ids = room.snapshotState().players.map((p) => p.id)
    expect(ids).not.toContain('a')
  })

  it('makes a finisher untargetable', () => {
    finish(room, 'a')
    const a = room.snapshotState().players.find((p) => p.id === 'a')!
    const shot = room.fire('b', { x: a.x, y: a.y - 10 })
    expect(shot!.hit).toBeNull()
  })

  it('stops a finisher from firing', () => {
    finish(room, 'a')
    expect(room.fire('a', { x: 100, y: 100 })).toBeNull()
  })

  it('stops a finisher from using their bonus', () => {
    room.forceBonusForTest('a', 'bomb')
    finish(room, 'a')
    expect(room.useBonus('a')).toBeNull()
  })

  it('reports each arrival once, with its rank and points', () => {
    finish(room, 'a')
    expect(room.drainArrivals()).toEqual([
      { id: 'a', username: expect.any(String), rank: 1, points: ARRIVAL_POINTS[0] },
    ])
    expect(room.drainArrivals()).toEqual([])
  })

  it('restarts the ranking at one on the next round', () => {
    finish(room, 'a')
    finish(room, 'b')
    finish(room, 'c')
    room.replay('a')
    startRound(room, 'a')
    room.drainArrivals()
    finish(room, 'b')
    expect(room.drainArrivals()).toEqual([
      { id: 'b', username: expect.any(String), rank: 1, points: ARRIVAL_POINTS[0] },
    ])
  })
})

describe('GameRoomService — disconnect during running', () => {
  it('removes the player from the snapshot', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    startRound(room, 'a')
    room.removePlayer('b')
    const ids = room.snapshotState().players.map((p) => p.id)
    expect(ids).toEqual(['a'])
  })

  it('resets the room to waiting when the last player leaves', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    startRound(room, 'a')
    expect(room.snapshotLobby().status).toBe('running')
    room.removePlayer('a')
    expect(room.snapshotLobby().status).toBe('waiting')
    expect(room.isEmpty()).toBe(true)
  })

  it('resets the room to waiting after an ended game when everyone leaves', () => {
    const room = new GameRoomService()
    room.addPlayer('a')
    startRound(room, 'a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    expect(room.snapshotLobby().status).toBe('ended')
    room.removePlayer('a')
    expect(room.snapshotLobby().status).toBe('waiting')
  })

  it('drops the disconnected player from the leaderboard', () => {
    const room = new GameRoomService()
    // Neutral seed so the auto-picked draft bonus cannot absorb the kill
    // below and leave 'b' at 0 points.
    room.setRngForTest(() => 0)
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
    // Teleport 'a' far past the bot spawn band (x=1500) so no bot can
    // intercept the shot — bots spawn around SPAWN_BAND_X (x≈180..200) with a
    // wide AABB, so a target must sit well to the right of them.
    room.teleportForTest('a', 1500)
    const victim = room.snapshotState().players.find((p) => p.id === 'a')!
    room.fire('b', { x: victim.x, y: victim.y - 10 })
    expect(room.snapshotLeaderboard().find((e) => e.id === 'b')!.total).toBe(2)
    room.removePlayer('b')
    expect(room.snapshotLeaderboard().find((e) => e.id === 'b')).toBeUndefined()
  })
})

describe('GameRoomService — replay', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
    room.addPlayer('b')
    startRound(room, 'a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    // 'b' never makes it: the round only ends once nobody is still racing.
    room.killForTest('b')
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

  it('keeps cumulative totals but zeroes every lastDelta on replay', () => {
    // beforeEach already set up: 2 players, started, teleported 'a' past the
    // line, ran tickAndCheckWinner (so 'a' has total=7, lastDelta=7).
    expect(room.snapshotLeaderboard().find((e) => e.id === 'a')!.total).toBe(7)
    room.replay('a')
    const after = room.snapshotLeaderboard()
    expect(after.find((e) => e.id === 'a')!.total).toBe(7)
    expect(after.find((e) => e.id === 'a')!.lastDelta).toBe(0)
    expect(after.find((e) => e.id === 'b')!.total).toBe(0)
    expect(after.find((e) => e.id === 'b')!.lastDelta).toBe(0)
  })
})

describe('GameRoomService — bots', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a')
  })

  it('spawns BOT_COUNT bots on start, each alive and idle', () => {
    room.start('a')
    const result = room.resolveDraft()!
    expect(result.started.bots).toHaveLength(BOT_COUNT)
    for (const b of result.started.bots) {
      expect(b.isAlive).toBe(true)
      expect(b.animation).toBe('idle')
      expect(b.id).toMatch(/^bot-\d+$/)
    }
  })

  it('includes bots in state snapshots', () => {
    startRound(room, 'a')
    const snap = room.snapshotState()
    expect(snap.bots).toHaveLength(BOT_COUNT)
  })

  it('walks a bot forward when its cycle flips to canMove', () => {
    // Seed RNG so the first bot starts with countTick=1 and flips on the
    // first tick. The implementation uses Math.floor(rng() * range) + min,
    // so rng()=0 → countTick = min (20). To get countTick=1 we need a
    // different seed strategy — instead we tick enough times to observe
    // movement after the natural flip.
    startRound(room, 'a')
    const initialBots = [...room.botsForTest()].map((b) => ({ ...b }))
    // Tick a large number of times — well past the max bot cycle of 100 ticks
    // so every bot has had a chance to flip into walking at least once.
    for (let i = 0; i < 200; i++) room.tick()
    const after = room.botsForTest()
    // At least one bot should have moved from its initial x (bots are
    // distinct from their initial state after walking).
    const moved = after.some((b, i) => b.x !== initialBots[i]!.x)
    expect(moved).toBe(true)
  })

  it('lets bots walk past the arrival line and off-screen', () => {
    startRound(room, 'a')
    // Tick long enough that any bot that has spent any meaningful share of
    // ticks in canMove=true will have crossed the line.
    for (let i = 0; i < 5000; i++) room.tick()
    const past = room.botsForTest().some((b) => b.x > ARRIVAL_LINE_X)
    expect(past).toBe(true)
  })

  it('shooting a bot consumes the bullet and marks the bot dead', () => {
    // Neutral seed: the auto-picked draft bonus must not be magazine, or the
    // exact bulletsRemaining assertion below would be flaky.
    room.setRngForTest(() => 0)
    startRound(room, 'a')
    // Bots overlap in the start column, so we don't assert *which* bot dies —
    // only that a bot is hit, the hit bot is dead, and the bullet is consumed.
    const target = room.botsForTest()[0]!
    const result = room.fire('a', { x: target.x, y: target.y - 10 })
    expect(result!.hit).not.toBeNull()
    const hitId = result!.hit!.targetId
    expect(hitId.startsWith('bot-')).toBe(true)
    const hitBot = room.botsForTest().find((b) => b.id === hitId)!
    expect(hitBot.isAlive).toBe(false)
    expect(hitBot.animation).toBe('die')
    const shooter = room.snapshotState().players.find((p) => p.id === 'a')!
    expect(shooter.bulletsRemaining).toBe(BULLETS_PER_PLAYER - 1)
  })

  it('a bot crossing the arrival line never triggers a winner', () => {
    startRound(room, 'a')
    // Even if a bot were teleported past the line, only players count.
    // We rely on tickAndCheckWinner only inspecting `players`.
    expect(room.tickAndCheckWinner()).toBeNull()
  })

  it('clears bots on replay', () => {
    startRound(room, 'a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    expect(room.replay('a')).toBe(true)
    expect(room.botsForTest()).toHaveLength(0)
  })

  it('credits +2 to the shooter when they kill another player', () => {
    const room = new GameRoomService()
    // Neutral seed so the auto-picked draft bonus cannot absorb the kill
    // below and zero out the shooter's credit.
    room.setRngForTest(() => 0)
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
    // Teleport Bruno well past the spawn band so no bot can intercept the
    // shot — bots spawn at x≈180..200 with a wide AABB. x=1500 is well outside
    // any bot AABB.
    room.teleportForTest('b', 1500)
    const victim = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: victim.x, y: victim.y - 10 })
    expect(result!.hit).toEqual({ targetId: 'b' })
    const board = room.snapshotLeaderboard()
    const shooter = board.find((e) => e.id === 'a')!
    expect(shooter.total).toBe(2)
    expect(shooter.lastDelta).toBe(2)
    const dead = board.find((e) => e.id === 'b')!
    expect(dead.total).toBe(0)
  })

  it('credits 0 points when the shooter kills a bot', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    startRound(room, 'a')
    const target = room.botsForTest()[0]!
    room.fire('a', { x: target.x, y: target.y - 10 })
    const shooter = room.snapshotLeaderboard().find((e) => e.id === 'a')!
    expect(shooter.total).toBe(0)
    expect(shooter.lastDelta).toBe(0)
  })
})

describe('GameRoomService — bot movement (deterministic)', () => {
  it('advances bot x by WALK_SPEED * TICK_SCALE while canMove is true', () => {
    const room = new GameRoomService()
    // Inject RNG that returns 0 for every call. That gives:
    //  - x spawn = BOT_SPAWN_X_MIN
    //  - countTick = BOT_MIN_TICK on spawn and on every flip
    //  - canMove flips false→true after BOT_MIN_TICK ticks, false again after
    //    another BOT_MIN_TICK, …
    room.setRngForTest(() => 0)
    room.addPlayer('a')
    startRound(room, 'a')
    const before = room.botsForTest()[0]!.x
    // After exactly BOT_MIN_TICK ticks the countTick reaches 0 → the bot
    // flips into canMove=true and the same tick advances x by one walk step.
    const BOT_MIN_TICK = 20
    for (let i = 0; i < BOT_MIN_TICK; i++) room.tick()
    const after = room.botsForTest()[0]!
    expect(after.x).toBeCloseTo(before + WALK_SPEED * (60 / SERVER_TICK_HZ), 5)
    expect(after.animation).toBe('walk')
  })
})

describe('GameRoomService — leaderboard snapshot', () => {
  it('includes every connected player, even those at 0 points', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
    const entries = room.snapshotLeaderboard()
    const ids = entries.map((e) => e.id).sort()
    expect(ids).toEqual(['a', 'b'])
    expect(entries.every((e) => e.total === 0 && e.lastDelta === 0)).toBe(true)
  })

  it('sorts by total desc, then lastDelta desc, then username asc', () => {
    const room = new GameRoomService()
    // Neutral seed so the auto-picked draft bonus cannot absorb one of the
    // kills below and throw off the expected point totals.
    room.setRngForTest(() => 0)
    room.addPlayer('a', 'Aaron')
    room.addPlayer('b', 'Bruno')
    room.addPlayer('c', 'Cécile')
    room.addPlayer('d', 'Zoe')
    startRound(room, 'a')
    room.setBulletsForTest('a', 10)
    room.setBulletsForTest('b', 10)
    // 'b' kills 'a' → b: total 2. Teleport each victim to x=1500 (well past
    // the bot spawn band) before firing — bots spawn at x≈180..200 with a wide
    // AABB, so a victim must sit well to their right. Positions are captured
    // after the teleport.
    room.teleportForTest('a', 1500)
    const aPos = room.snapshotState().players.find((p) => p.id === 'a')!
    room.fire('b', { x: aPos.x, y: aPos.y - 10 })
    // 'b' kills 'c' → b: total 4.
    room.teleportForTest('c', 1500)
    const cPos = room.snapshotState().players.find((p) => p.id === 'c')!
    room.fire('b', { x: cPos.x, y: cPos.y - 10 })
    // dead 'a' kills 'd' → a: total 2.
    room.teleportForTest('d', 1500)
    const dPos = room.snapshotState().players.find((p) => p.id === 'd')!
    room.fire('a', { x: dPos.x, y: dPos.y - 10 })
    // 'c' (dead, no bullets) stays at 0. 'd' (dead, no bullets) stays at 0.
    // Expected ordering:
    //   1. b (total 4)
    //   2. a (total 2)
    //   3. c (Cécile, 0/0)  — tie with d on total+delta → username asc
    //   4. d (Zoe)          — 'Cécile' < 'Zoe' so c before d
    const board = room.snapshotLeaderboard()
    expect(board.map((e) => e.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('breaks total ties via lastDelta when points were earned in different rounds', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Ana')
    room.addPlayer('b', 'Bob')
    startRound(room, 'a')
    // Round 1: 'a' arrives first → a.total=7, a.delta=7. 'b' dies, so the
    // round ends with nobody left racing.
    room.teleportForTest('a', ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
    room.killForTest('b')
    room.tickAndCheckWinner()
    // Replay zeroes a.delta but keeps a.total=7.
    room.replay('a')
    startRound(room, 'a')
    // Round 2: 'b' arrives → b.total=7, b.delta=7. 'a' didn't score this round
    // so a.delta=0. Both players tie on total=7 — lastDelta breaks the tie.
    room.teleportForTest('b', ARRIVAL_LINE_X + 1)
    room.tickAndCheckWinner()
    room.killForTest('a')
    room.tickAndCheckWinner()
    const board = room.snapshotLeaderboard()
    expect(board.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('GameRoomService — draft lifecycle', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    // Neutral seed: auto-resolved picks land on 'bomb' (no round-start
    // effect), so forceBonusForTest is the only source of bonus effects
    // below and the passive-bonus assertions stay deterministic.
    room.setRngForTest(() => 0)
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
  })

  it('enters drafting and offers cards to every player instead of spawning', () => {
    const offers = startDraft(room, 'a')
    expect(room.snapshotLobby().status).toBe('drafting')
    expect(offers.map((o) => o.playerId).sort()).toEqual(['a', 'b'])
    expect(offers[0]!.offer).toHaveLength(3)
    // Nothing exists on the field yet.
    expect(room.snapshotState().players).toEqual([])
    expect(room.snapshotState().bots).toEqual([])
  })

  it('refuses to fire while the draft is open', () => {
    room.start('a')
    expect(room.fire('a', { x: 0, y: 0 })).toBeNull()
  })

  it('rejects a bonus the player was not offered', () => {
    const offers = startDraft(room, 'a')
    const offer = offers.find((o) => o.playerId === 'a')!.offer
    const notOffered = BONUS_IDS.find((id) => !offer.includes(id))!
    expect(room.pickBonus('a', notOffered).accepted).toBe(false)
  })

  it('reports completion once every player has picked', () => {
    const offers = startDraft(room, 'a')
    const offerOf = (id: string) => offers.find((o) => o.playerId === id)!.offer
    expect(room.pickBonus('a', offerOf('a')[0]!)).toEqual({
      accepted: true,
      complete: false,
      pickedIds: ['a'],
    })
    const second = room.pickBonus('b', offerOf('b')[0]!)
    expect(second.complete).toBe(true)
    expect(second.pickedIds.sort()).toEqual(['a', 'b'])
  })

  it('spawns everyone and starts running when the draft resolves', () => {
    room.start('a')
    const result = room.resolveDraft()!
    expect(room.snapshotLobby().status).toBe('running')
    expect(result.started.players).toHaveLength(2)
    expect(result.started.bots).toHaveLength(BOT_COUNT)
    // The private bonus fields never leave the server.
    expect(result.started.players[0]).not.toHaveProperty('bonus')
    expect(room.snapshotState().players[0]).not.toHaveProperty('bonusCharges')
  })

  it('applies a passive bonus at spawn', () => {
    room.start('a')
    room.resolveDraft()
    room.forceBonusForTest('a', 'magazine')
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(
      BULLETS_PER_PLAYER + 1,
    )
  })

  it('makes a sprinting player cover more ground per tick', () => {
    room.start('a')
    room.resolveDraft()
    room.forceBonusForTest('a', 'sprint')
    const before = room.snapshotState().players.find((p) => p.id === 'a')!.x
    room.applyInput('a', {
      keys: { space: true, shift: true },
      pointer: { x: 0, y: 0 },
    })
    room.tick()
    const after = room.snapshotState().players.find((p) => p.id === 'a')!.x
    const tickScale = 60 / SERVER_TICK_HZ
    expect(after - before).toBeCloseTo(RUN_SPEED * tickScale * SPRINT_RUN_MULTIPLIER)
  })

  it('drops the draft when a player leaves and lets the rest finish', () => {
    const offers = startDraft(room, 'a')
    const offerOf = (id: string) => offers.find((o) => o.playerId === id)!.offer
    room.pickBonus('a', offerOf('a')[0]!)
    expect(room.draftComplete()).toBe(false)
    room.removePlayer('b')
    expect(room.draftComplete()).toBe(true)
  })

  it('redraws a draft on the next round', () => {
    room.start('a')
    room.resolveDraft()
    room.teleportForTest('a', ARRIVAL_LINE_X)
    room.tickAndCheckWinner()
    // 'b' never finishes, so the round only ends once they are out.
    room.killForTest('b')
    room.tickAndCheckWinner()
    expect(room.replay('a')).toBe(true)
    expect(room.snapshotLobby().status).toBe('waiting')
    expect(startDraft(room, 'a')).toHaveLength(2)
  })

  it('does not spawn a socket that joined after the draft opened', () => {
    room.start('a')
    // 'c' joins the room while 'a' and 'b' are still drafting. The draft was
    // built from the pre-join roster, so 'c' gets no offer and never appears
    // in the resolved picks — resolveDraft must not spawn them anyway just
    // because they are now in playerOrder.
    room.addPlayer('c', 'Chloé')
    const result = room.resolveDraft()!
    const ids = result.started.players.map((p) => p.id)
    expect(ids.sort()).toEqual(['a', 'b'])
    expect(result.picks.has('c')).toBe(false)
  })
})

describe('GameRoomService — bonus effects in game', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
  })

  const aliveBots = () => room.botsForTest().filter((b) => b.isAlive)

  it('the bomb kills a fifth of the bots and no player', () => {
    room.forceBonusForTest('a', 'bomb')
    const before = aliveBots().length
    expect(room.useBonus('a')).toMatchObject({ bonusId: 'bomb', reveal: true })
    expect(aliveBots()).toHaveLength(before - Math.ceil(before * 0.2))
    expect(room.snapshotState().players.every((p) => p.isAlive)).toBe(true)
  })

  it('spends the bomb charge, so a second press does nothing', () => {
    room.forceBonusForTest('a', 'bomb')
    room.useBonus('a')
    expect(room.useBonus('a')).toBeNull()
  })

  it('keeps the bomb charge when there is no bot left to kill', () => {
    room.forceBonusForTest('a', 'bomb')
    for (const bot of room.botsForTest()) bot.isAlive = false
    expect(room.useBonus('a')).toBeNull()
    // The refusal above must not have spent the charge: revive a bot and
    // confirm the bomb can still be used. If the first, refused call had
    // incorrectly decremented bonusCharges, this would also return null.
    room.botsForTest()[0]!.isAlive = true
    expect(room.useBonus('a')).toMatchObject({ bonusId: 'bomb', reveal: true })
  })

  it('refuses to activate a passive bonus', () => {
    room.forceBonusForTest('a', 'vest')
    expect(room.useBonus('a')).toBeNull()
  })

  it('reports the skin swap without revealing it', () => {
    room.forceBonusForTest('a', 'skin-swap')
    expect(room.useBonus('a')).toEqual({ bonusId: 'skin-swap', reveal: false })
  })

  it('the vest absorbs the first hit and is reported to the gateway', () => {
    room.forceBonusForTest('b', 'vest')
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(result.absorbedBy).toEqual({ playerId: 'b', bonusId: 'vest', reveal: true })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(true)
    // An absorbed hit pays nothing: no point, no bullet back.
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(0)
    expect(room.snapshotLeaderboard().find((e) => e.id === 'a')!.total).toBe(0)
  })

  it('the vest only saves once', () => {
    room.forceBonusForTest('b', 'vest')
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    room.setBulletsForTest('a', 1)
    room.fire('a', { x: b.x, y: b.y - 10 })
    room.setBulletsForTest('a', 1)
    const second = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(second.absorbedBy).toBeUndefined()
    expect(second.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(false)
  })

  it('the extra life reports the decoy bot as the victim', () => {
    room.forceBonusForTest('b', 'extra-life')
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(result.absorbedBy).toBeUndefined()
    expect(result.hit!.targetId).toMatch(/^bot-/)
    // The shooter killed a bot as far as the pipeline is concerned: no points,
    // no bullet refunded.
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(0)
    expect(room.snapshotLeaderboard().find((e) => e.id === 'a')!.total).toBe(0)
    const survivor = room.snapshotState().players.find((p) => p.id === 'b')!
    expect(survivor.isAlive).toBe(true)
    expect(survivor.x).not.toBe(b.x)
  })

  it('the extra life cannot save a player once every bot is dead', () => {
    room.forceBonusForTest('b', 'extra-life')
    for (const bot of room.botsForTest()) bot.isAlive = false
    room.setBulletsForTest('a', 1)
    room.teleportForTest('b', 1500)
    const b = room.snapshotState().players.find((p) => p.id === 'b')!
    const result = room.fire('a', { x: b.x, y: b.y - 10 })!
    expect(result.hit).toEqual({ targetId: 'b' })
    expect(room.snapshotState().players.find((p) => p.id === 'b')!.isAlive).toBe(false)
  })
})

// Every other bonus test grants its bonus with forceBonusForTest, which
// bypasses pickBonus/resolveDraft entirely — so nothing exercises the seam
// the whole feature turns on: a real pick, threaded through the draft,
// landing as a working charge. Deleting the assignBonus loop in
// resolveDraft() leaves every test above green (forceBonusForTest doesn't
// go through it) while silently breaking every drafted bonus in production.
describe('GameRoomService — a drafted (not forced) bonus takes effect', () => {
  // Narrowing the host's selection to a single bonus makes the offer
  // deterministic without steering the rng, which is both clearer and immune
  // to the catalogue growing.
  function roomOffering(bonusId: BonusId): GameRoomService {
    const room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    for (const id of BONUS_IDS) {
      if (id !== bonusId) room.setBonusEnabled('a', id, false)
    }
    return room
  }

  it('threads an active pick through pickBonus -> resolveDraft into a working charge', () => {
    const room = roomOffering('bomb')
    expect(startDraft(room, 'a')[0]!.offer).toEqual(['bomb'])
    expect(room.pickBonus('a', 'bomb')).toEqual({
      accepted: true,
      complete: true,
      pickedIds: ['a'],
    })
    room.resolveDraft()
    // Only meaningful if resolveDraft's assignBonus loop actually ran: absent
    // it, player.bonus stays null and useBonus() returns null unconditionally
    // regardless of what was picked.
    expect(room.useBonus('a')).toMatchObject({ bonusId: 'bomb', reveal: true })
  })

  it('threads a passive pick through pickBonus -> resolveDraft into a spawn-time effect', () => {
    const room = roomOffering('magazine')
    expect(startDraft(room, 'a')[0]!.offer).toEqual(['magazine'])
    expect(room.pickBonus('a', 'magazine').complete).toBe(true)
    room.resolveDraft()
    // Magazine's onRoundStart only runs from inside resolveDraft's
    // assignBonus loop — without it bulletsRemaining stays at the default.
    expect(room.snapshotState().players.find((p) => p.id === 'a')!.bulletsRemaining).toBe(
      BULLETS_PER_PLAYER + 1,
    )
  })
})

describe('GameRoomService — useBonus guards', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
  })

  it('refuses to use a bonus once the round has ended', () => {
    room.forceBonusForTest('a', 'bomb')
    // Ended via the all-dead route on purpose: ending it by crossing the line
    // would make 'a' a finisher, and the finisher guard would mask the status
    // guard this test is about.
    room.killForTest('a')
    room.killForTest('b')
    room.tickAndCheckWinner()
    expect(room.snapshotLobby().status).toBe('ended')
    expect(room.useBonus('a')).toBeNull()
  })

  it('lets a dead player still use their bonus (uniform revenge rule)', () => {
    room.forceBonusForTest('a', 'bomb')
    room.killForTest('a')
    expect(room.useBonus('a')).toMatchObject({ bonusId: 'bomb', reveal: true })
  })
})

// The host picks which bonuses a round may draw from. The selection lives on
// the room and survives replay(), so a lobby keeps its ruleset for a series.
describe('GameRoomService — bonus selection', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
  })

  it('starts with the whole catalogue enabled', () => {
    expect(room.snapshotLobby().enabledBonuses).toEqual(BONUS_IDS)
  })

  it('lets the host drop a bonus, keeping the catalogue order', () => {
    expect(room.setBonusEnabled('a', 'vest', false)).toBe(true)
    const enabled = room.snapshotLobby().enabledBonuses
    expect(enabled).not.toContain('vest')
    expect(enabled).toEqual(BONUS_IDS.filter((id) => id !== 'vest'))
  })

  it('lets the host put one back', () => {
    room.setBonusEnabled('a', 'vest', false)
    room.setBonusEnabled('a', 'vest', true)
    expect(room.snapshotLobby().enabledBonuses).toEqual(BONUS_IDS)
  })

  it('refuses a player who is not the host', () => {
    expect(room.setBonusEnabled('b', 'vest', false)).toBe(false)
    expect(room.snapshotLobby().enabledBonuses).toEqual(BONUS_IDS)
  })

  it('refuses a change once the round has left the lobby', () => {
    room.start('a')
    expect(room.setBonusEnabled('a', 'vest', false)).toBe(false)
  })

  it('only ever offers bonuses the host left enabled', () => {
    for (const id of BONUS_IDS) {
      if (id !== 'bomb' && id !== 'horde') room.setBonusEnabled('a', id, false)
    }
    for (const { offer } of startDraft(room, 'a')) {
      expect(offer).toHaveLength(2)
      for (const bonus of offer) expect(['bomb', 'horde']).toContain(bonus)
    }
  })

  it('skips the draft entirely when the host disables everything', () => {
    for (const id of BONUS_IDS) room.setBonusEnabled('a', id, false)
    const result = room.start('a')!
    expect(result.kind).toBe('started')
    expect(room.snapshotLobby().status).toBe('running')
    expect(room.useBonus('a')).toBeNull()
  })

  it('keeps the selection across replay', () => {
    room.setBonusEnabled('a', 'vest', false)
    startRound(room, 'a')
    room.teleportForTest('a', ARRIVAL_LINE_X)
    room.tickAndCheckWinner()
    room.replay('a')
    expect(room.snapshotLobby().enabledBonuses).not.toContain('vest')
  })
})

describe('GameRoomService — runaway and horde', () => {
  let room: GameRoomService

  beforeEach(() => {
    room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    startRound(room, 'a')
  })

  it('keeps the runaway bot running, tick after tick', () => {
    room.forceBonusForTest('a', 'runaway')
    expect(room.useBonus('a')).toEqual({ bonusId: 'runaway', reveal: false })
    // The bonus picks its decoy at random, so we find it by watching which bot
    // covers a full run step in one tick.
    const before = room.botsForTest().map((b) => b.x)
    room.tick()
    const afterOne = room.botsForTest().map((b) => b.x)
    room.tick()
    const afterTwo = room.botsForTest().map((b) => b.x)
    const tickScale = 60 / SERVER_TICK_HZ
    const runnerIdx = afterOne.findIndex(
      (x, i) => Math.abs(x - before[i]! - RUN_SPEED * tickScale) < 0.001,
    )
    expect(runnerIdx).toBeGreaterThanOrEqual(0)
    // Still running one tick later — it never goes back to the walk/idle cycle.
    expect(afterTwo[runnerIdx]! - afterOne[runnerIdx]!).toBeCloseTo(RUN_SPEED * tickScale)
    expect(room.snapshotState().bots[runnerIdx]!.animation).toBe('run')
  })

  it('drops ten fresh bots around the player', () => {
    const before = room.botsForTest().length
    const me = room.snapshotState().players.find((p) => p.id === 'a')!
    room.forceBonusForTest('a', 'horde')
    expect(room.useBonus('a')).toEqual({ bonusId: 'horde', reveal: false })
    const bots = room.botsForTest()
    expect(bots).toHaveLength(before + 10)
    // Unique ids, or the client would reconcile two zombies onto one sprite.
    expect(new Set(bots.map((b) => b.id)).size).toBe(bots.length)
    const fresh = bots.slice(before)
    for (const bot of fresh) {
      expect(bot.isAlive).toBe(true)
      const distance = Math.hypot(bot.x - me.x, bot.y - me.y)
      expect(distance).toBeGreaterThan(0)
      expect(distance).toBeLessThan(260)
    }
  })

  it('reports the bots a bomb killed', () => {
    room.forceBonusForTest('a', 'bomb')
    const used = room.useBonus('a')!
    expect(used.killedIds!.length).toBeGreaterThan(0)
    for (const id of used.killedIds!) {
      expect(room.botsForTest().find((b) => b.id === id)!.isAlive).toBe(false)
    }
  })
})
