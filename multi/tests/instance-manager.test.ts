import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../src/config.js'
import type { InstanceRegistry } from '../src/gateway/ApiRouter.js'
import { InstanceManager } from '../src/instances/InstanceManager.js'

interface CreateContainerOptions {
  image: string
  instanceId: string
  token: string
  romPath?: string
  networkName: string
  emulatorPort: number
}

interface ContainerInfo {
  id: string
  host: string
  port: number
}

interface ManagedContainer {
  id: string
  instanceId: string
  host: string
  token?: string
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

const dockerMock = vi.hoisted(() => {
  const createdOptions: CreateContainerOptions[] = []
  const stoppedContainers: string[] = []
  const listedContainers: ManagedContainer[] = []
  const runningContainers = new Map<string, boolean>()
  const createResponses: ContainerInfo[] = []

  class DockerDriver {
    createContainer(opts: CreateContainerOptions): Promise<ContainerInfo> {
      createdOptions.push(opts)
      return Promise.resolve(
        createResponses.shift() ?? {
          id: `container-${opts.instanceId}`,
          host: `pss-mgba-${opts.instanceId}`,
          port: opts.emulatorPort,
        },
      )
    }

    stopContainer(containerId: string): Promise<void> {
      stoppedContainers.push(containerId)
      return Promise.resolve()
    }

    listManagedContainers(): Promise<ManagedContainer[]> {
      return Promise.resolve([...listedContainers])
    }

    inspectContainer(containerId: string): Promise<{ running: boolean }> {
      return Promise.resolve({ running: runningContainers.get(containerId) ?? false })
    }
  }

  return {
    DockerDriver,
    createdOptions,
    stoppedContainers,
    listedContainers,
    runningContainers,
    createResponses,
    reset() {
      createdOptions.length = 0
      stoppedContainers.length = 0
      listedContainers.length = 0
      runningContainers.clear()
      createResponses.length = 0
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

vi.mock('../src/instances/DockerDriver.js', () => ({
  DockerDriver: dockerMock.DockerDriver,
}))

vi.mock('../src/mgba/MgbaSocketClient.js', () => ({
  MgbaSocketClient: mgbaMock.MgbaSocketClient,
}))

describe('InstanceManager', () => {
  beforeEach(() => {
    dockerMock.reset()
    mgbaMock.reset()
    vi.useRealTimers()
  })

  it('create() starts a Docker container, waits for mGBA, and adds the instance to the registry', async () => {
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    const info = await manager.create('/rom/custom.gb')

    expect(info.status).toBe('running')
    expect(info.containerId).toBe(`container-${info.id}`)
    expect(dockerMock.createdOptions).toEqual([
      {
          image: 'pss-mgba-emulator',
          instanceId: info.id,
          token: info.token,
          romPath: '/rom/custom.gb',
          networkName: 'pss-mgba-net',
        emulatorPort: 8888,
      },
    ])
    expect(mgbaMock.clients[0]?.connectCalls).toEqual([{ host: info.containerHost, port: 8888 }])
    expect(registry.get(info.token)?.info).toBe(info)
    expect(manager.getByToken(info.token)).toBe(info)
  })

  it('destroy() stops the container, disconnects the client, and removes the registry entry', async () => {
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)
    const info = await manager.create()

    await manager.destroy(info.id)

    expect(dockerMock.stoppedContainers).toEqual([info.containerId])
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

  it('reconstructs running managed containers from Docker on startup', async () => {
    dockerMock.listedContainers.push({
      id: 'container-existing',
      instanceId: 'instance-existing',
      host: 'pss-mgba-instance-existing',
      token: 'persisted-token',
    })
    dockerMock.runningContainers.set('container-existing', true)
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    await manager.reconstruct()

    const info = manager.get('instance-existing')
    expect(info?.containerId).toBe('container-existing')
    expect(info?.containerHost).toBe('pss-mgba-instance-existing')
    expect(info?.token).toBe('persisted-token')
    expect(info?.status).toBe('running')
    expect(registry.size).toBe(1)
    expect(mgbaMock.clients[0]?.connectCalls).toEqual([{ host: 'pss-mgba-instance-existing', port: 8888 }])
  })
})

function createConfig(): Config {
  return {
    port: 8787,
    adminToken: 'admin-token',
    maxInstances: 10,
    emulatorImage: 'pss-mgba-emulator',
    emulatorPort: 8888,
    captureIntervalMs: 100,
    jpegQuality: 60,
    wsBackpressureLimit: 262_144,
    networkName: 'pss-mgba-net',
    romPath: '/rom/default.gb',
  }
}
