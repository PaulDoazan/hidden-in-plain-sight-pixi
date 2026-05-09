import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@hips/shared'
import { io, type Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export class NetworkManager {
  private socket: AppSocket | null = null

  connect(): void {
    if (this.socket) return
    this.socket = io(SERVER_URL, { withCredentials: true })
    this.socket.on('connect', () => {
      console.log('[net] connected', this.socket?.id)
    })
    this.socket.on('disconnect', (reason) => {
      console.log('[net] disconnected', reason)
    })
  }

  on<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
  ): void {
    if (!this.socket)
      throw new Error(`NetworkManager.on('${String(event)}') called before connect()`)
    // socket.io-client's typed `on` accepts the matching handler signature.
    this.socket.on(event, handler as never)
  }

  off<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
  ): void {
    this.socket?.off(event, handler as never)
  }

  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void {
    if (!this.socket)
      throw new Error(`NetworkManager.emit('${String(event)}') called before connect()`)
    // Cast through unknown to avoid socket.io-client's internal overload complexity.
    ;(this.socket.emit as (e: string, ...a: unknown[]) => void)(event as string, ...args)
  }

  get id(): string | undefined {
    return this.socket?.id
  }

  get raw(): AppSocket | null {
    return this.socket
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }
}
