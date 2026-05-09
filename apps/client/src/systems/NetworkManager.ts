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

  get raw(): AppSocket | null {
    return this.socket
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }
}
