import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get()
  hello(): { status: 'ok'; phase: 1 } {
    return { status: 'ok', phase: 1 }
  }
}
