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
  FirePayload,
  InputPayload,
  ServerToClientEvents,
} from '@hips/shared'
import { SERVER_TICK_HZ } from '@hips/shared'
import type { Server, Socket } from 'socket.io'

import { GameRoomService } from './game-room.service'

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type AppServer = Server<ClientToServerEvents, ServerToClientEvents>

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  @WebSocketServer()
  private readonly server!: AppServer

  private tickHandle: ReturnType<typeof setInterval> | null = null

  constructor(private readonly room: GameRoomService) {}

  handleConnection(socket: AppSocket): void {
    this.logger.log(`connected: ${socket.id}`)
    this.room.addPlayer(socket.id)
    this.broadcastLobby()
  }

  handleDisconnect(socket: AppSocket): void {
    this.logger.log(`disconnected: ${socket.id}`)
    this.room.removePlayer(socket.id)
    this.broadcastLobby()
  }

  @SubscribeMessage('start')
  onStart(@ConnectedSocket() socket: AppSocket): void {
    const result = this.room.start(socket.id)
    if (!result) return
    this.server.emit('game-started', result)
    this.broadcastLobby()
    this.startTickLoop()
  }

  @SubscribeMessage('input')
  onInput(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: InputPayload,
  ): void {
    this.room.applyInput(socket.id, payload)
  }

  @SubscribeMessage('fire')
  onFire(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: FirePayload,
  ): void {
    const result = this.room.fire(socket.id, payload.pointer)
    if (!result) return
    this.server.emit('shot-fired', result)
    if (result.hit) {
      this.server.emit('player-killed', { id: result.hit.targetId })
    }
  }

  private startTickLoop(): void {
    if (this.tickHandle) return
    const intervalMs = 1000 / SERVER_TICK_HZ
    this.tickHandle = setInterval(() => {
      this.room.tick()
      this.server.emit('state', this.room.snapshotState())
    }, intervalMs)
  }

  private stopTickLoop(): void {
    if (!this.tickHandle) return
    clearInterval(this.tickHandle)
    this.tickHandle = null
  }

  private broadcastLobby(): void {
    this.server.emit('lobby-state', this.room.snapshotLobby())
  }
}
