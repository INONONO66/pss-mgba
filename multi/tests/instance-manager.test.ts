import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../src/config.js'
import type { InstanceRegistry } from '../src/gateway/ApiRouter.js'
import { InstanceManager } from '../src/instances/InstanceManager.js'

interface ProcessCreateOptions {
  instanceId: string
  romPath: string
  port: number
  mgbaBinary: string
  luaScriptPath: string
  frameDir: string
}

interface MockChildProcess {
  on(event: string, handler: () => void): MockChildProcess
}

interface MgbaClientMock {
  connectCalls: Array<{ host: string; port: number }>
  disconnectCalls: number
  connected: boolean
  pingResponses: boolean[]
  connect(host: string, port: number): Promise<void>
  ping(): Promise<boolean>
  disconnect(): void
  isConnected(): boolean
}

const processMock = vi.hoisted(() => {
  const spawnOptions: ProcessCreateOptions[] = []
  const killedPids: number[] = []
  let nextPid = 10_000

  class ProcessDriver {
    spawn(opts: ProcessCreateOptions): Promise<{ pid: number; port: number; process: MockChildProcess }> {
      spawnOptions.push(opts)
      nextPid += 1
      return Promise.resolve({
        pid: nextPid,
        port: opts.port,
        process: {
          on() {
            return this
          },
        },
      })
    }

    kill(pid: number): Promise<void> {
      killedPids.push(pid)
      return Promise.resolve()
    }
  }

  return {
    ProcessDriver,
    spawnOptions,
    killedPids,
    reset() {
      spawnOptions.length = 0
      killedPids.length = 0
      nextPid = 10_000
    },
  }
})

const mgbaMock = vi.hoisted(() => {
  const clients: MgbaClientMock[] = []
  const defaultPingResponses: boolean[] = [true]

  class MgbaSocketClient implements MgbaClientMock {
    connectCalls: Array<{ host: string; port: number }> = []
    disconnectCalls = 0
    connected = false
    pingResponses: boolean[] = [...defaultPingResponses]

    constructor() {
      clients.push(this)
    }

    connect(host: string, port: number): Promise<void> {
      this.connectCalls.push({ host, port })
      this.connected = true
      return Promise.resolve()
    }

    ping(): Promise<boolean> {
      return Promise.resolve(this.pingResponses.shift() ?? true)
    }

    disconnect(): void {
      this.disconnectCalls += 1
      this.connected = false
    }

    isConnected(): boolean {
      return this.connected
    }
  }

  return {
    MgbaSocketClient,
    clients,
    defaultPingResponses,
    reset() {
      clients.length = 0
      defaultPingResponses.length = 0
      defaultPingResponses.push(true)
    },
  }
})

vi.mock('../src/instances/ProcessDriver.js', () => ({
  ProcessDriver: processMock.ProcessDriver,
}))

vi.mock('../src/mgba/MgbaSocketClient.js', () => ({
  MgbaSocketClient: mgbaMock.MgbaSocketClient,
}))

describe('InstanceManager', () => {
  beforeEach(() => {
    processMock.reset()
    mgbaMock.reset()
    vi.useRealTimers()
  })

  it('create() spawns mGBA, waits for Lua socket, and adds the instance to the registry', async () => {
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    const info = await manager.create('/rom/custom.gb')

    expect(info.status).toBe('running')
    expect(info.pid).toBe(10_001)
    expect(info.port).toBe(8888)
    expect(info.framePath).toBe(`/tmp/frames/${info.id}`)
    expect(processMock.spawnOptions).toEqual([
      {
        instanceId: info.id,
        romPath: '/rom/custom.gb',
        port: 8888,
        mgbaBinary: 'mgba-sdl',
        luaScriptPath: '/app/mGBASocketServer.lua',
        frameDir: '/tmp/frames',
      },
    ])
    expect(mgbaMock.clients[0]?.connectCalls).toEqual([{ host: '127.0.0.1', port: 8888 }])
    expect(registry.get(info.token)?.info).toBe(info)
    expect(manager.getByToken(info.token)).toBe(info)
  })

  it('destroy() kills the process, disconnects the client, and removes the registry entry', async () => {
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)
    const info = await manager.create()

    await manager.destroy(info.id)

    expect(processMock.killedPids).toEqual([info.pid])
    expect(mgbaMock.clients[0]?.disconnectCalls).toBe(1)
    expect(registry.has(info.token)).toBe(false)
    expect(manager.get(info.id)).toBeUndefined()
  })

  it('enforces the configured maximum instance count', async () => {
    const manager = new InstanceManager(createConfig(), new Map())

    for (let count = 0; count < 10; count += 1) {
      await manager.create()
    }

    await expect(manager.create()).rejects.toThrow('MAX_INSTANCES_REACHED')
  })

  it('marks an instance as error when the health check ping fails', async () => {
    vi.useFakeTimers()
    const manager = new InstanceManager(createConfig(), new Map())
    const info = await manager.create()
    const client = mgbaMock.clients[0]
    if (!client) {
      throw new Error('expected mGBA client')
    }
    client.pingResponses.push(false)

    manager.startHealthChecks()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(manager.get(info.id)?.status).toBe('error')
    manager.stopHealthChecks()
  })

  it('reconstruct() is a process-based no-op', async () => {
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    await manager.reconstruct()

    expect(manager.list()).toEqual([])
    expect(registry.size).toBe(0)
    expect(processMock.spawnOptions).toEqual([])
  })
})

function createConfig(): Config {
  return {
    port: 8787,
    adminToken: 'admin-token',
    maxInstances: 10,
    baseLuaPort: 8888,
    mgbaBinary: 'mgba-sdl',
    luaScriptPath: '/app/mGBASocketServer.lua',
    frameDir: '/tmp/frames',
    captureIntervalMs: 100,
    jpegQuality: 60,
    wsBackpressureLimit: 262_144,
    romPath: '/rom/default.gb',
  }
}
