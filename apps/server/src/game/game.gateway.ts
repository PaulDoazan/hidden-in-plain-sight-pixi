import { Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@hips/shared'
import type { Socket } from 'socket.io'

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  handleConnection(socket: AppSocket): void {
    this.logger.log(`connected: ${socket.id}`)
  }

  handleDisconnect(socket: AppSocket): void {
    this.logger.log(`disconnected: ${socket.id}`)
  }
}
