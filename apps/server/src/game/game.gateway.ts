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
  ClientToServerEvents,
  CreateRoomPayload,
  FirePayload,
  InputPayload,
  JoinRoomPayload,
  ServerToClientEvents,
} from '@hips/shared'
import { SERVER_TICK_HZ } from '@hips/shared'
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
    if (room.isEmpty()) {
      this.stopTickLoop(code)
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
    this.server.to(ctx.code).emit('game-started', result)
    this.broadcastLobby(ctx.code)
    this.startTickLoop(ctx.code)
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

  @SubscribeMessage('fire')
  onFire(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: FirePayload,
  ): void {
    const ctx = this.roomFor(socket)
    if (!ctx) return
    const result = ctx.room.fire(socket.id, payload.pointer, payload.scale)
    if (!result) return
    this.server.to(ctx.code).emit('shot-fired', result)
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
        ...(username ? { username, killerUsername } : {}),
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
      if (result) {
        this.stopTickLoop(code)
        if (result.reason === 'arrival') {
          this.server.to(code).emit('game-ended', {
            reason: 'arrival',
            winnerId: result.winnerId,
            winnerUsername: room.usernameFor(result.winnerId),
          })
        } else {
          this.server.to(code).emit('game-ended', { reason: 'all-dead' })
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
