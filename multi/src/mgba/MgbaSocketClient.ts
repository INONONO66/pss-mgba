import { Socket } from 'node:net'

import { ACK_MESSAGE, formatMessage, TERMINATION_MARKER } from './protocol.js'

interface PendingResponse {
  resolve: (value: string) => void
  reject: (error: Error) => void
}

interface Endpoint {
  host: string
  port: number
}

export class MgbaSocketClient {
  private socket: Socket | undefined
  private endpoint: Endpoint | undefined
  private buffer = ''
  private connected = false
  private pendingResponse: PendingResponse | undefined
  private responseBacklog: string[] = []
  private queue: Promise<void> = Promise.resolve()
  private connectPromise: Promise<void> | undefined

  connect(host: string, port: number): Promise<void> {
    this.endpoint = { host, port }
    return this.openSocket({ host, port })
  }

  send(message: string): Promise<string> {
    const response = this.queue.then(() => this.sendOnce(message))
    this.queue = response.then(
      () => undefined,
      () => undefined,
    )
    return response
  }

  disconnect(): void {
    this.connected = false
    this.connectPromise = undefined
    this.rejectPending(new Error('mGBA socket disconnected'))
    this.socket?.destroy()
    this.socket = undefined
    this.buffer = ''
    this.responseBacklog = []
  }

  isConnected(): boolean {
    return this.connected && this.socket !== undefined && !this.socket.destroyed
  }

  async ping(): Promise<boolean> {
    const response = await this.send(formatMessage('core.currentFrame'))
    return response.trim() !== '' && Number.isFinite(Number(response))
  }

  private async sendOnce(message: string): Promise<string> {
    await this.ensureConnected()

    return new Promise<string>((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('mGBA socket is not connected'))
        return
      }

      const socket = this.socket
      if (!socket) {
        reject(new Error('mGBA socket is not connected'))
        return
      }

      this.waitForResponse().then(resolve, reject)
      socket.write(message, (error) => {
        if (error) {
          this.rejectPending(error)
        }
      })
    })
  }

  private ensureConnected(): Promise<void> {
    if (this.isConnected()) {
      return Promise.resolve()
    }

    if (!this.endpoint) {
      return Promise.reject(new Error('mGBA socket has no saved endpoint'))
    }

    return this.openSocket(this.endpoint)
  }

  private openSocket(endpoint: Endpoint): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }

    this.disconnectForReconnect()

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new Socket()
      this.socket = socket
      this.buffer = ''
      this.responseBacklog = []

      let settled = false

      const failConnect = (error: Error): void => {
        if (!settled) {
          settled = true
          this.connectPromise = undefined
          this.connected = false
          socket.destroy()
          reject(error)
        }
      }

      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => this.handleData(chunk))
      socket.on('error', (error: Error) => {
        this.connected = false
        this.connectPromise = undefined
        this.rejectPending(error)
        failConnect(error)
      })
      socket.on('close', () => {
        this.connected = false
        this.connectPromise = undefined
        this.rejectPending(new Error('mGBA socket closed'))
      })

      socket.connect(endpoint.port, endpoint.host, () => {
        this.connected = true
        this.waitForResponse()
          .then(() => {
            settled = true
            this.connectPromise = undefined
            resolve()
          })
          .catch(failConnect)

        socket.write(formatMessage(ACK_MESSAGE), (error) => {
          if (error) {
            failConnect(error)
          }
        })
      })
    })

    return this.connectPromise
  }

  private waitForResponse(): Promise<string> {
    const nextResponse = this.responseBacklog.shift()
    if (nextResponse !== undefined) {
      return Promise.resolve(nextResponse)
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingResponse = { resolve, reject }
    })
  }

  private handleData(chunk: string): void {
    this.buffer += chunk

    while (true) {
      const markerIndex = this.buffer.indexOf(TERMINATION_MARKER)
      if (markerIndex === -1) {
        return
      }

      const messageEnd = markerIndex + TERMINATION_MARKER.length
      const rawMessage = this.buffer.slice(0, messageEnd)
      this.buffer = this.buffer.slice(messageEnd)
      this.resolvePending(rawMessage.slice(0, -TERMINATION_MARKER.length))
    }
  }

  private resolvePending(value: string): void {
    const pending = this.pendingResponse
    if (!pending) {
      this.responseBacklog.push(value)
      return
    }

    this.pendingResponse = undefined
    pending.resolve(value)
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingResponse
    if (!pending) {
      return
    }

    this.pendingResponse = undefined
    pending.reject(error)
  }

  private disconnectForReconnect(): void {
    this.connected = false
    this.rejectPending(new Error('mGBA socket reconnecting'))
    this.socket?.destroy()
    this.socket = undefined
    this.buffer = ''
    this.responseBacklog = []
  }
}
