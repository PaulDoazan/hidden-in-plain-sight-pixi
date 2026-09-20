import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type {
  BonusId,
  ClientToServerEvents,
  CreateRoomPayload,
  FirePayload,
  InputPayload,
  JoinRoomPayload,
  PickBonusPayload,
  SetBonusPayload,
  ServerToClientEvents,
} from '@hips/shared'
import { DRAFT_DURATION_MS, SERVER_TICK_HZ } from '@hips/shared'
import type { Server, Socket } from 'socket.io'

import { getCorsOrigin } from '../config/cors-origin'

import { GameRoomService } from './game-room.service'
import { RoomRegistry } from './room-registry.service'

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type AppServer = Server<ClientToServerEvents, ServerToClientEvents>

@WebSocketGateway({ cors: { origin: getCorsOrigin(), credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  @WebSocketServer()
  private readonly server!: AppServer

  // Per-room tick loop handles. Each room ticks independently at 30 Hz once
  // its `start` is acknowledged, and is cleared on game-end or empty-room.
  private readonly tickHandles = new Map<string, ReturnType<typeof setInterval>>()

  // Per-room draft deadline. Same lifecycle as tickHandles: armed when the
  // draft opens, cleared when it resolves or the room dies.
  private readonly draftHandles = new Map<string, ReturnType<typeof setTimeout>>()

  // socketId → roomCode mapping. Populated on create-room / join-room, cleared
  // on disconnect. A socket without an entry here is connected but not yet
  // attached to a room (sitting on HomeScene).
  private readonly socketRooms = new Map<string, string>()

  constructor(private readonly registry: RoomRegistry) {}

  handleConnection(socket: AppSocket): void {
    this.logger.log(`connected: ${socket.id}`)
    // No room assignment yet: client must emit create-room or join-room.
  }

  handleDisconnect(socket: AppSocket): void {
    this.logger.log(`disconnected: ${socket.id}`)
    const code = this.socketRooms.get(socket.id)
    if (!code) return
    this.socketRooms.delete(socket.id)
    const room = this.registry.get(code)
    if (!room) return
    room.removePlayer(socket.id)
    this.server.to(code).emit('player-left', { id: socket.id })
    this.broadcastLobby(code)
    // A player leaving mid-draft may be the one everyone was waiting for.
    if (room.isDrafting() && room.draftComplete()) this.resolveDraft(code)
    if (room.isEmpty()) {
      this.stopTickLoop(code)
      this.clearDraftTimer(code)
      this.registry.remove(code)
    }
  }

  @SubscribeMessage('create-room')
  onCreateRoom(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: CreateRoomPayload,
  ): void {
    if (this.socketRooms.has(socket.id)) {
      socket.emit('room-join-failed', { reason: 'already-in-room' })
      return
    }
    const { code, room } = this.registry.create()
    room.addPlayer(socket.id, payload?.username ?? '')
    this.socketRooms.set(socket.id, code)
    void socket.join(code)
    socket.emit('room-created', { code, lobby: room.snapshotLobby() })
    this.broadcastLobby(code)
    this.logger.log(`room ${code} created by ${socket.id}`)
  }

  @SubscribeMessage('join-room')
  onJoinRoom(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: JoinRoomPayload,
  ): void {
    if (this.socketRooms.has(socket.id)) {
      socket.emit('room-join-failed', { reason: 'already-in-room' })
      return
    }
    const code = payload.code.toUpperCase()
    const room = this.registry.get(code)
    if (!room) {
      socket.emit('room-join-failed', { reason: 'not-found' })
      return
    }
    room.addPlayer(socket.id, payload.username ?? '')
    this.socketRooms.set(socket.id, code)
    void socket.join(code)
    socket.emit('room-joined', { code, lobby: room.snapshotLobby() })
    this.broadcastLobby(code)
  }

  @SubscribeMessage('start')
  onStart(@ConnectedSocket() socket: AppSocket): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const result = ctx.room.start(socket.id)
    if (!result) return
    // Bonuses off: the room skipped the draft and is already running, so
    // there is no offer to deliver and no deadline to arm.
    if (result.kind === 'started') {
      this.server.to(ctx.code).emit('game-started', result.started)
      this.broadcastLobby(ctx.code)
      this.startTickLoop(ctx.code)
      return
    }
    // Socket.io puts every socket in a room named after its own id, so this
    // delivers each player only its own three cards.
    for (const { playerId, offer } of result.offers) {
      this.server.to(playerId).emit('bonus-draft-started', {
        offer,
        durationMs: DRAFT_DURATION_MS,
      })
    }
    this.broadcastLobby(ctx.code)
    this.armDraftTimer(ctx.code)
  }

  @SubscribeMessage('set-bonus')
  onSetBonus(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: SetBonusPayload,
  ): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    if (!ctx.room.setBonusEnabled(socket.id, payload.bonusId, payload.enabled)) return
    // The setting rides on the lobby snapshot, so every player sees what the
    // room is about to play, not just the host who flipped it.
    this.broadcastLobby(ctx.code)
  }

  @SubscribeMessage('pick-bonus')
  onPickBonus(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: PickBonusPayload,
  ): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const result = ctx.room.pickBonus(socket.id, payload.bonusId)
    if (!result.accepted) return
    this.server.to(ctx.code).emit('bonus-draft-progress', { pickedIds: result.pickedIds })
    if (result.complete) this.resolveDraft(ctx.code)
  }

  private armDraftTimer(code: string): void {
    if (this.draftHandles.has(code)) return
    const handle = setTimeout(() => this.resolveDraft(code), DRAFT_DURATION_MS)
    this.draftHandles.set(code, handle)
  }

  private clearDraftTimer(code: string): void {
    const handle = this.draftHandles.get(code)
    if (!handle) return
    clearTimeout(handle)
    this.draftHandles.delete(code)
  }

  // Both paths out of the draft — everyone picked, or the clock ran out —
  // land here.
  private resolveDraft(code: string): void {
    this.clearDraftTimer(code)
    const room = this.registry.get(code)
    if (!room) return
    const result = room.resolveDraft()
    if (!result) return
    // Authoritative per-owner signal, sent before `game-started`: a client's
    // own click is not enough, because the timeout path (BonusDraft.resolve())
    // may have auto-picked a different card — or the only card — for anyone
    // who didn't click in time. Socket.io puts every socket in a room named
    // after its own id, same pattern as `bonus-draft-started`.
    for (const [playerId, bonusId] of result.picks) {
      this.server.to(playerId).emit('bonus-granted', { bonusId })
    }
    this.server.to(code).emit('game-started', result.started)
    this.broadcastLobby(code)
    this.startTickLoop(code)
  }

  @SubscribeMessage('input')
  onInput(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: InputPayload,
  ): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    ctx.room.applyInput(socket.id, payload)
  }

  @SubscribeMessage('replay')
  onReplay(@ConnectedSocket() socket: AppSocket): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    if (!ctx.room.replay(socket.id)) return
    this.broadcastLobby(ctx.code)
  }

  @SubscribeMessage('use-bonus')
  onUseBonus(@ConnectedSocket() socket: AppSocket): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const used = ctx.room.useBonus(socket.id)
    if (!used) return
    this.emitBonusUsed(ctx.code, socket.id, used.bonusId, used.reveal, used.killedIds)
  }

  // A revealed bonus goes to the whole room, owner included. A silent one
  // goes to its owner alone — their HUD still has to learn the charge is
  // spent. Socket.io puts every socket in a room named after its own id, so
  // both cases are just a `to()`.
  private emitBonusUsed(
    code: string,
    playerId: string,
    bonusId: BonusId,
    reveal: boolean,
    killedIds?: string[],
  ): void {
    const room = this.registry.get(code)
    if (!room) return
    const payload = {
      playerId,
      username: room.usernameFor(playerId),
      bonusId,
      ...(killedIds ? { killedIds } : {}),
    }
    this.server.to(reveal ? code : playerId).emit('bonus-used', payload)
  }

  @SubscribeMessage('fire')
  onFire(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: FirePayload,
  ): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const result = ctx.room.fire(socket.id, payload.pointer, payload.scale)
    if (!result) return
    // Emit an explicit ShotFiredPayload rather than the service's raw return
    // value: `result` also carries `absorbedBy`, which must stay server-only
    // (it names the bonus, which is secret). Socket.io doesn't run excess-
    // property checks on a variable, so passing `result` straight through
    // would silently leak it to the whole room.
    this.server.to(ctx.code).emit('shot-fired', {
      shooterId: result.shooterId,
      origin: result.origin,
      hit: result.hit,
    })
    if (result.absorbedBy) {
      // The target's bonus swallowed the shot. No kill event: the bonus is
      // announced instead (or not — `reveal` is the hook's own call, not an
      // assumption that "absorbed" always means "reveal"), which is also what
      // tells its owner it is spent.
      this.emitBonusUsed(
        ctx.code,
        result.absorbedBy.playerId,
        result.absorbedBy.bonusId,
        result.absorbedBy.reveal,
      )
      return
    }
    if (result.hit) {
      // Bots have no entry in the usernames map → usernameFor returns ''.
      // Only attach `username` when it's a real player so the client can
      // distinguish "show death banner" from "silent bot kill". The shooter
      // is always a real player (sockets only), so killerUsername is attached
      // alongside the victim's username for the kill-feed banner.
      const username = ctx.room.usernameFor(result.hit.targetId)
      const killerUsername = ctx.room.usernameFor(socket.id)
      this.server.to(ctx.code).emit('player-killed', {
        id: result.hit.targetId,
        ...(username ? { username, killerUsername, killerId: socket.id } : {}),
      })
    }
  }

  private roomFor(socket: AppSocket): { code: string; room: GameRoomService } | null {
    const code = this.socketRooms.get(socket.id)
    if (!code) return null
    const room = this.registry.get(code)
    if (!room) return null
    return { code, room }
  }

  private startTickLoop(code: string): void {
    if (this.tickHandles.has(code)) return
    const intervalMs = 1000 / SERVER_TICK_HZ
    const handle = setInterval(() => {
      const room = this.registry.get(code)
      if (!room) {
        this.stopTickLoop(code)
        return
      }
      const result = room.tickAndCheckWinner()
      this.server.to(code).emit('state', room.snapshotState())
      // Announced before any 'game-ended': the last arrival of a round is
      // registered by the very tick that ends it, and a client that learned
      // its rank only through the leaderboard would miss the banner.
      for (const arrival of room.drainArrivals()) {
        this.server.to(code).emit('player-arrived', arrival)
      }
      if (result) {
        this.stopTickLoop(code)
        const leaderboard = room.snapshotLeaderboard()
        if (result.reason === 'arrival') {
          this.server.to(code).emit('game-ended', {
            reason: 'arrival',
            winnerId: result.winnerId,
            winnerUsername: room.usernameFor(result.winnerId),
            leaderboard,
          })
        } else {
          this.server.to(code).emit('game-ended', {
            reason: 'all-dead',
            leaderboard,
          })
        }
        this.broadcastLobby(code)
      }
    }, intervalMs)
    this.tickHandles.set(code, handle)
  }

  private stopTickLoop(code: string): void {
    const handle = this.tickHandles.get(code)
    if (!handle) return
    clearInterval(handle)
    this.tickHandles.delete(code)
  }

  private broadcastLobby(code: string): void {
    const room = this.registry.get(code)
    if (!room) return
    this.server.to(code).emit('lobby-state', room.snapshotLobby())
  }
}
