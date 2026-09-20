import { Module } from '@nestjs/common'

import { GameGateway } from './game.gateway'
import { RoomRegistry } from './room-registry.service'

@Module({ providers: [GameGateway, RoomRegistry] })
export class GameModule {}
