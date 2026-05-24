import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { MgbaSocketClient } from '../src/mgba/MgbaSocketClient.js'
import {
  ERROR_MARKER,
  formatMessage,
  parseResponse,
  SUCCESS_MARKER,
  TERMINATION_MARKER,
} from '../src/mgba/protocol.js'

const HOST = '127.0.0.1'

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('server did not bind to a TCP port'))
        return
      }
      resolve((address as AddressInfo).port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
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

function splitMessages(buffer: string): { messages: string[]; remaining: string } {
  const messages: string[] = []
  let remaining = buffer

  while (true) {
    const markerIndex = remaining.indexOf(TERMINATION_MARKER)
    if (markerIndex === -1) {
      return { messages, remaining }
    }

    messages.push(remaining.slice(0, markerIndex))
    remaining = remaining.slice(markerIndex + TERMINATION_MARKER.length)
  }
}

describe('mGBA socket protocol helpers', () => {
  it('formats messages with and without arguments', () => {
    expect(formatMessage('core.currentFrame')).toBe('core.currentFrame<|END|>')
    expect(formatMessage('memoryDomain.read8', 'System Bus', '49152')).toBe(
      'memoryDomain.read8,System Bus,49152<|END|>',
    )
  })

  it('parses success, error, and plain responses', () => {
    expect(parseResponse(`${SUCCESS_MARKER}${TERMINATION_MARKER}`)).toEqual({
      value: SUCCESS_MARKER,
      isSuccess: true,
      isError: false,
    })
    expect(parseResponse(`${ERROR_MARKER}${TERMINATION_MARKER}`)).toEqual({
      value: ERROR_MARKER,
      isSuccess: false,
      isError: true,
    })
    expect(parseResponse(`12345${TERMINATION_MARKER}`)).toEqual({
      value: '12345',
      isSuccess: false,
      isError: false,
    })
  })
})

describe('MgbaSocketClient', () => {
  const servers: Server[] = []
  const clients: MgbaSocketClient[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect()
    }

    await Promise.all(servers.splice(0).map((server) => closeServer(server)))
  })

  async function createMockServer(
    onMessage: (message: string, socket: Socket) => void,
  ): Promise<{ server: Server; port: number }> {
    const server = createServer((socket) => {
      socket.setEncoding('utf8')
      socket.on('error', () => undefined)
      let buffer = ''

      socket.on('data', (chunk: string) => {
        buffer += chunk
        const split = splitMessages(buffer)
        buffer = split.remaining

        for (const message of split.messages) {
          if (message === '<|ACK|>') {
            socket.write(`${SUCCESS_MARKER}${TERMINATION_MARKER}`)
            continue
          }

          onMessage(message, socket)
        }
      })
    })

    servers.push(server)
    return { server, port: await listen(server) }
  }

  it('splits partial TCP reads and multiple messages in one chunk', async () => {
    const { port } = await createMockServer((message, socket) => {
      if (message === 'partial') {
        socket.write('12')
        setTimeout(() => socket.write(`345${TERMINATION_MARKER}`), 5)
        return
      }

      socket.write(`first${TERMINATION_MARKER}second${TERMINATION_MARKER}`)
    })

    const client = new MgbaSocketClient()
    clients.push(client)
    await client.connect(HOST, port)

    await expect(client.send(formatMessage('partial'))).resolves.toBe('12345')
    await expect(client.send(formatMessage('multi'))).resolves.toBe('first')
    await expect(client.send(formatMessage('from-backlog'))).resolves.toBe('second')
  })

  it('round-trips through a mock TCP server', async () => {
    const { port } = await createMockServer((message, socket) => {
      if (message === 'core.currentFrame') {
        socket.write(`12345${TERMINATION_MARKER}`)
      }
    })

    const client = new MgbaSocketClient()
    clients.push(client)
    await client.connect(HOST, port)

    await expect(client.send(formatMessage('core.currentFrame'))).resolves.toBe('12345')
    await expect(client.ping()).resolves.toBe(true)
  })

  it('serializes concurrent requests in order', async () => {
    const received: string[] = []
    const { port } = await createMockServer((message, socket) => {
      received.push(message)

      if (message === 'first') {
        setTimeout(() => socket.write(`one${TERMINATION_MARKER}`), 20)
        return
      }

      socket.write(`two${TERMINATION_MARKER}`)
    })

    const client = new MgbaSocketClient()
    clients.push(client)
    await client.connect(HOST, port)

    const first = client.send(formatMessage('first'))
    const second = client.send(formatMessage('second'))

    await expect(first).resolves.toBe('one')
    expect(received).toEqual(['first'])
    await expect(second).resolves.toBe('two')
    expect(received).toEqual(['first', 'second'])
  })

  it('reconnects on the next send after the socket disconnects', async () => {
    let connectionCount = 0
    const { port } = await createMockServer((message, socket) => {
      if (message === 'core.currentFrame') {
        socket.write(`777${TERMINATION_MARKER}`)
      }
    })

    servers[0].on('connection', (socket) => {
      connectionCount += 1
      if (connectionCount === 1) {
        setTimeout(() => socket.destroy(), 10)
      }
    })

    const client = new MgbaSocketClient()
    clients.push(client)
    await client.connect(HOST, port)
    await new Promise((resolve) => setTimeout(resolve, 30))

    await expect(client.send(formatMessage('core.currentFrame'))).resolves.toBe('777')
    expect(connectionCount).toBe(2)
  })
})
