import { Module } from '@nestjs/common'

import { GameGateway } from './game.gateway'
import { GameRoomService } from './game-room.service'

@Module({ providers: [GameGateway, GameRoomService] })
export class GameModule {}
