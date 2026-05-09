import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { ClientToServerEvents, ServerToClientEvents } from '@hips/shared'
import type { Server, Socket } from 'socket.io'

import { GameRoomService } from './game-room.service'

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>
type AppServer = Server<ClientToServerEvents, ServerToClientEvents>

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  @WebSocketServer()
  private readonly server!: AppServer

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
  }

  private broadcastLobby(): void {
    this.server.emit('lobby-state', this.room.snapshotLobby())
  }
}
