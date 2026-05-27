import type { IncomingMessage } from 'node:http'

import type { WebSocket, WebSocketServer } from 'ws'

import type { InstanceRegistry } from '../gateway/ApiRouter.js'
import type { CapturedFrame } from './FrameCapture.js'

export class DashboardBroadcast {
  private readonly dashboardClients = new Set<WebSocket>()
  private readonly instanceClients = new Map<string, Set<WebSocket>>()
  private readonly latestFrames = new Map<string, Buffer>()
  private readonly wss: WebSocketServer
  private readonly registry: InstanceRegistry
  private readonly backpressureLimit: number

  constructor(
    wss: WebSocketServer,
    registry: InstanceRegistry,
    backpressureLimit: number,
  ) {
    this.wss = wss
    this.registry = registry
    this.backpressureLimit = backpressureLimit
    this.setupWebSocketServer()
  }

  broadcastFrame(frame: CapturedFrame): void {
    const binary = encodeFrame(frame)
    this.latestFrames.set(frame.token, binary)

    for (const ws of this.dashboardClients) {
      sendWithBackpressure(ws, binary, this.backpressureLimit)
    }

    const instanceSubscribers = this.instanceClients.get(frame.token)
    if (!instanceSubscribers) {
      return
    }

    for (const ws of instanceSubscribers) {
      sendWithBackpressure(ws, binary, this.backpressureLimit)
    }
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req)
    })
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = req.url ?? ''

    if (url.startsWith('/ws/dashboard')) {
      this.dashboardClients.add(ws)
      ws.on('close', () => this.dashboardClients.delete(ws))
      ws.on('error', () => this.dashboardClients.delete(ws))
      for (const [token, frame] of this.latestFrames) {
        if (this.registry.has(token)) {
          sendWithBackpressure(ws, frame, this.backpressureLimit)
        }
      }
      return
    }

    if (url.startsWith('/ws/instance/')) {
      const token = url.slice('/ws/instance/'.length)
      if (!this.registry.has(token)) {
        ws.close(4001, 'Unknown token')
        return
      }

      let clients = this.instanceClients.get(token)
      if (!clients) {
        clients = new Set<WebSocket>()
        this.instanceClients.set(token, clients)
      }

      clients.add(ws)
      ws.on('close', () => clients.delete(ws))
      ws.on('error', () => clients.delete(ws))
      const cached = this.latestFrames.get(token)
      if (cached) sendWithBackpressure(ws, cached, this.backpressureLimit)
      return
    }

    ws.close(4000, 'Unknown endpoint')
  }
}

export function encodeFrame(frame: CapturedFrame): Buffer {
  const jpegLen = frame.jpegBuffer.length
  const buf = Buffer.allocUnsafe(5 + jpegLen)
  buf[0] = frame.instanceIndex % 256
  buf.writeUInt32LE(frame.timestampMs % 4_294_967_296, 1)
  frame.jpegBuffer.copy(buf, 5)
  return buf
}

function sendWithBackpressure(ws: WebSocket, data: Buffer, limit: number): void {
  if (ws.readyState !== ws.OPEN) {
    return
  }

  if (ws.bufferedAmount > limit) {
    return
  }

  ws.send(data, { binary: true }, () => undefined)
}
