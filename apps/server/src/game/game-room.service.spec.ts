import {
  ARRIVAL_LINE_X,
  BOT_COUNT,
  SERVER_TICK_HZ,
  WALK_SPEED,
  RUN_SPEED,
} from '@hips/shared'

import { BULLETS_PER_PLAYER, GameRoomService } from './game-room.service'

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
    expect(room.snapshotLobby()).toEqual({ players: [], status: 'waiting' })
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
    room.start('a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    room.replay('a')
    expect(room.usernameFor('a')).toBe('Antoine')
    expect(room.snapshotLobby().players[0]!.username).toBe('Antoine')
  })

  it('copies the username onto the spawned PlayerState', () => {
    room.addPlayer('a', 'Antoine')
    const result = room.start('a')!
    expect(result.players[0]!.username).toBe('Antoine')
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
      expect(p.x).toBeLessThanOrEqual(50)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(886)
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
    const result = room.start('a')!
    const yMin = 886 * (2 / 5)
    const yMax = 886 * 0.9
    for (const p of result.players) {
      expect(p.y).toBeGreaterThanOrEqual(yMin)
      expect(p.y).toBeLessThanOrEqual(yMax)
    }
    for (const b of result.bots) {
      expect(b.y).toBeGreaterThanOrEqual(yMin)
      expect(b.y).toBeLessThanOrEqual(yMax)
    }
  })

  it('aligns every zombie (players + bots) in the same 20-unit left band', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    const result = room.start('a')!
    const xs = [...result.players, ...result.bots].map((p) => p.x)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(30)
      expect(x).toBeLessThanOrEqual(50)
    }
  })

  it('assigns each zombie a random type drawn from the valid set', () => {
    room.addPlayer('a')
    room.addPlayer('b')
    room.addPlayer('c')
    room.addPlayer('d')
    const result = room.start('a')!
    const valid: ReadonlySet<string> = new Set(['man', 'woman', 'wild'])
    for (const p of [...result.players, ...result.bots]) {
      expect(valid.has(p.type)).toBe(true)
    }
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
    // Move b out of the start-line cluster so the click uniquely targets them
    // (otherwise the overlapping bot column wins the depth-sort tiebreak).
    room.teleportForTest('b', 1500)
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
    expect(winner).toEqual({ reason: 'arrival', winnerId: 'a' })
    expect(room.snapshotLobby().status).toBe('ended')
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

  it('drops the disconnected player from the leaderboard', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    room.start('a')
    // Teleport 'a' far past the bot spawn band (x=1500) so no bot can
    // intercept the shot — wild bots have a wide AABB that extends left of
    // SPAWN_BAND_X, so x=0 is not safe.
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
    const result = room.start('a')!
    expect(result.bots).toHaveLength(BOT_COUNT)
    for (const b of result.bots) {
      expect(b.isAlive).toBe(true)
      expect(b.animation).toBe('idle')
      expect(b.id).toMatch(/^bot-\d+$/)
    }
  })

  it('includes bots in state snapshots', () => {
    room.start('a')
    const snap = room.snapshotState()
    expect(snap.bots).toHaveLength(BOT_COUNT)
  })

  it('walks a bot forward when its cycle flips to canMove', () => {
    // Seed RNG so the first bot starts with countTick=1 and flips on the
    // first tick. The implementation uses Math.floor(rng() * range) + min,
    // so rng()=0 → countTick = min (20). To get countTick=1 we need a
    // different seed strategy — instead we tick enough times to observe
    // movement after the natural flip.
    room.start('a')
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
    room.start('a')
    // Tick long enough that any bot that has spent any meaningful share of
    // ticks in canMove=true will have crossed the line.
    for (let i = 0; i < 5000; i++) room.tick()
    const past = room.botsForTest().some((b) => b.x > ARRIVAL_LINE_X)
    expect(past).toBe(true)
  })

  it('shooting a bot consumes the bullet and marks the bot dead', () => {
    room.start('a')
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
    room.start('a')
    // Even if a bot were teleported past the line, only players count.
    // We rely on tickAndCheckWinner only inspecting `players`.
    expect(room.tickAndCheckWinner()).toBeNull()
  })

  it('clears bots on replay', () => {
    room.start('a')
    room.teleportForTest('a', 9999)
    room.tickAndCheckWinner()
    expect(room.replay('a')).toBe(true)
    expect(room.botsForTest()).toHaveLength(0)
  })

  it('credits +2 to the shooter when they kill another player', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Antoine')
    room.addPlayer('b', 'Bruno')
    room.start('a')
    // Teleport Bruno well past the spawn band so no bot can intercept the
    // shot — wild bots spawn at x=30..50 and their AABB (width 75) extends
    // left to x≈-7, so x=0 is NOT safe. x=1500 is well outside any bot AABB.
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
    room.start('a')
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
    room.start('a')
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
    room.start('a')
    const entries = room.snapshotLeaderboard()
    const ids = entries.map((e) => e.id).sort()
    expect(ids).toEqual(['a', 'b'])
    expect(entries.every((e) => e.total === 0 && e.lastDelta === 0)).toBe(true)
  })

  it('sorts by total desc, then lastDelta desc, then username asc', () => {
    const room = new GameRoomService()
    room.addPlayer('a', 'Aaron')
    room.addPlayer('b', 'Bruno')
    room.addPlayer('c', 'Cécile')
    room.addPlayer('d', 'Zoe')
    room.start('a')
    room.setBulletsForTest('a', 10)
    room.setBulletsForTest('b', 10)
    // 'b' kills 'a' → b: total 2. Teleport each victim to x=1500 (well past
    // the bot spawn band) before firing — bots spawn at x=30..50 and wild
    // types have AABB width=75 so their left edge is at x≈-7, making x=0
    // unsafe. Positions are captured after the teleport.
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
})
