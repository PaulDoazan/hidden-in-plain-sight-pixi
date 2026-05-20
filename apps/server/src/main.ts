import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { getCorsOrigin } from './config/cors-origin'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: { origin: getCorsOrigin(), credentials: true },
  })
  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
}
void bootstrap()
