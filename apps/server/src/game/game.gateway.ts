import { Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets'
import type { Socket } from 'socket.io'

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name)

  handleConnection(socket: Socket): void {
    this.logger.log(`connected: ${socket.id}`)
  }

  handleDisconnect(socket: Socket): void {
    this.logger.log(`disconnected: ${socket.id}`)
  }
}
