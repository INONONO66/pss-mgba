import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer, type RawData } from 'ws'

import type { InstanceRegistry } from '../src/gateway/ApiRouter.js'
import { MgbaSocketClient } from '../src/mgba/MgbaSocketClient.js'
import { DashboardBroadcast, encodeFrame } from '../src/streaming/DashboardBroadcast.js'
import type { CapturedFrame } from '../src/streaming/FrameCapture.js'

const HOST = '127.0.0.1'
const TOKEN_A = 'token-a'
const TOKEN_B = 'token-b'

describe('DashboardBroadcast', () => {
  const fixtures: BroadcastFixture[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
  })

  it('encodes frames with instance index, little-endian timestamp, and JPEG bytes', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9])

    const encoded = encodeFrame(createFrame({ instanceIndex: 7, timestampMs: 0x12_34_56_78, jpegBuffer }))

    expect(encoded.subarray(0, 5)).toEqual(Buffer.from([0x07, 0x78, 0x56, 0x34, 0x12]))
    expect(encoded.subarray(5)).toEqual(jpegBuffer)
  })

  it('drops frames for clients over the backpressure limit', async () => {
    const fixture = await createFixture(8)
    fixtures.push(fixture)
    const overLimit = fixture.nextServerSocket()
    const client = await fixture.connect('/ws/dashboard')
    const serverSocket = await overLimit
    Object.defineProperty(serverSocket, 'bufferedAmount', { value: 9, configurable: true })

    const messagePromise = nextMessage(client, 30)
    fixture.broadcast.broadcastFrame(createFrame())

    await expect(messagePromise).resolves.toBeUndefined()
  })

  it('registers dashboard clients and removes them after close', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const client = await fixture.connect('/ws/dashboard')

    const firstMessage = nextMessage(client)
    fixture.broadcast.broadcastFrame(createFrame({ timestampMs: 1 }))
    expect(await firstMessage).toEqual(encodeFrame(createFrame({ timestampMs: 1 })))

    await closeClient(client)
    fixture.broadcast.broadcastFrame(createFrame({ timestampMs: 2 }))
  })

  it('routes per-instance frames only to matching token subscribers', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const clientA = await fixture.connect(`/ws/instance/${TOKEN_A}`)
    const clientB = await fixture.connect(`/ws/instance/${TOKEN_B}`)

    const messageA = nextMessage(clientA)
    const messageB = nextMessage(clientB, 30)
    const frame = createFrame({ token: TOKEN_A, instanceId: 'instance-a', timestampMs: 9 })
    fixture.broadcast.broadcastFrame(frame)

    await expect(messageA).resolves.toEqual(encodeFrame(frame))
    await expect(messageB).resolves.toBeUndefined()
  })
})

interface BroadcastFixture {
  broadcast: DashboardBroadcast
  close(): Promise<void>
  connect(path: string): Promise<WebSocket>
  nextServerSocket(): Promise<WebSocket>
}

async function createFixture(backpressureLimit = 262_144): Promise<BroadcastFixture> {
  const httpServer = createServer()
  const wss = new WebSocketServer({ server: httpServer })
  const registry = createRegistry()
  const broadcast = new DashboardBroadcast(wss, registry, backpressureLimit)
  const port = await listen(httpServer)
  const clients = new Set<WebSocket>()

  return {
    broadcast,
    async close() {
      await Promise.all([...clients].map((client) => closeClient(client)))
      await closeWebSocketServer(wss)
      await closeHttpServer(httpServer)
    },
    async connect(path: string) {
      const client = new WebSocket(`ws://${HOST}:${port}${path}`)
      clients.add(client)
      client.on('close', () => clients.delete(client))
      await openClient(client)
      return client
    },
    nextServerSocket() {
      return new Promise((resolve) => {
        wss.once('connection', (ws) => resolve(ws))
      })
    },
  }
}

function createRegistry(): InstanceRegistry {
  return new Map([
    [TOKEN_A, createRegistryEntry(TOKEN_A, 'instance-a')],
    [TOKEN_B, createRegistryEntry(TOKEN_B, 'instance-b')],
  ])
}

function createRegistryEntry(token: string, id: string) {
  return {
    info: {
      id,
      token,
      containerId: `container-${id}`,
      containerHost: '127.0.0.1',
      status: 'running' as const,
      createdAt: new Date('2026-05-25T00:00:00Z'),
    },
    client: new MgbaSocketClient(),
  }
}

function createFrame(overrides: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    instanceIndex: 0,
    instanceId: 'instance-a',
    token: TOKEN_A,
    jpegBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    timestampMs: 123,
    ...overrides,
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('HTTP server did not bind to a TCP port'))
        return
      }

      resolve((address as AddressInfo).port)
    })
  })
}

function openClient(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('error', reject)
    client.once('open', () => {
      client.off('error', reject)
      resolve()
    })
  })
}

function closeClient(client: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (client.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }

    client.once('close', () => resolve())
    client.close()
  })
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function nextMessage(client: WebSocket, timeoutMs = 250): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('error', reject)
      client.off('message', onMessage)
      resolve(undefined)
    }, timeoutMs)

    function onMessage(data: RawData): void {
      clearTimeout(timer)
      client.off('error', reject)
      resolve(rawDataToBuffer(data))
    }

    client.once('error', reject)
    client.once('message', onMessage)
  })
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }

  return Buffer.from(data)
}
