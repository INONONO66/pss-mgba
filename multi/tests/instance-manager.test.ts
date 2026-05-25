import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../src/config.js'
import type { InstanceRegistry } from '../src/gateway/ApiRouter.js'
import { InstanceManager } from '../src/instances/InstanceManager.js'

const fsMock = vi.hoisted(() => ({
  lstat: vi.fn((value: string) => Promise.resolve({
    isDirectory: () => value.startsWith('/tmp/pss-mgba-captures-test/') && value !== '/tmp/pss-mgba-captures-test/',
  })),
  realpath: vi.fn((value: string) => Promise.resolve(value)),
  rm: vi.fn(() => Promise.resolve()),
}))

vi.mock('node:fs/promises', () => ({
  lstat: fsMock.lstat,
  realpath: fsMock.realpath,
  rm: fsMock.rm,
}))

interface CreateContainerOptions {
  image: string
  instanceId: string
  romPath?: string
  networkName: string
  emulatorPort: number
  emulatorMemoryBytes: number
  captureRoot: string
}

interface ContainerInfo {
  id: string
  host: string
  port: number
  captureDirectory: string
}

interface ManagedContainer {
  id: string
  instanceId: string
  host: string
  captureDirectory?: string
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
          captureDirectory: `${opts.captureRoot}/${opts.instanceId}`,
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
    fsMock.lstat.mockClear()
    fsMock.realpath.mockClear()
    fsMock.rm.mockClear()
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
        romPath: '/rom/custom.gb',
        networkName: 'pss-mgba-net',
        emulatorPort: 8888,
        emulatorMemoryBytes: 805_306_368,
        captureRoot: '/tmp/pss-mgba-captures-test',
      },
    ])
    expect(mgbaMock.clients[0]?.connectCalls).toEqual([{ host: info.containerHost, port: 8888 }])
    expect(registry.get(info.token)?.info).toBe(info)
    expect(manager.getByToken(info.token)).toBe(info)
  })

  it('cleans up the container and capture directory when socket readiness fails', async () => {
    vi.useFakeTimers()
    mgbaMock.defaultPingResponses.length = 0
    mgbaMock.defaultPingResponses.push(...Array.from({ length: 100 }, () => false))
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    const createPromise = manager.create()
    const rejection = expect(createPromise).rejects.toThrow('Lua socket not ready')
    await vi.advanceTimersByTimeAsync(31_000)

    await rejection
    expect(dockerMock.stoppedContainers).toHaveLength(1)
    expect(fsMock.rm).toHaveBeenCalledWith(expect.stringContaining('/tmp/pss-mgba-captures-test/'), { force: true, recursive: true })
    expect(registry.size).toBe(0)
  })

  it('destroy() stops the container, disconnects the client, and removes the registry entry', async () => {
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)
    const info = await manager.create()

    await manager.destroy(info.id)

    expect(dockerMock.stoppedContainers).toEqual([info.containerId])
    expect(mgbaMock.clients[0]?.disconnectCalls).toBe(1)
    expect(registry.has(info.token)).toBe(false)
    expect(fsMock.rm).toHaveBeenCalledWith(info.captureDirectory, { force: true, recursive: true })
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

  it('skips reconstructed containers with capture directories outside captureRoot', async () => {
    dockerMock.listedContainers.push({
      id: 'container-escaped',
      instanceId: 'instance-escaped',
      host: 'pss-mgba-instance-escaped',
      captureDirectory: '/tmp/outside/instance-escaped',
    })
    dockerMock.runningContainers.set('container-escaped', true)
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    await manager.reconstruct()

    expect(manager.get('instance-escaped')).toBeUndefined()
    expect(dockerMock.stoppedContainers).toEqual(['container-escaped'])
    expect(registry.size).toBe(0)
    expect(mgbaMock.clients).toHaveLength(0)
  })


  it('stops legacy managed containers that do not have a capture directory label', async () => {
    dockerMock.listedContainers.push({
      id: 'container-legacy',
      instanceId: 'instance-legacy',
      host: 'pss-mgba-instance-legacy',
    })
    dockerMock.runningContainers.set('container-legacy', true)
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    await manager.reconstruct()

    expect(manager.get('instance-legacy')).toBeUndefined()
    expect(dockerMock.stoppedContainers).toEqual(['container-legacy'])
    expect(registry.size).toBe(0)
  })

  it('reconstructs running managed containers from Docker on startup', async () => {
    dockerMock.listedContainers.push({
      id: 'container-existing',
      instanceId: 'instance-existing',
      host: 'pss-mgba-instance-existing',
      captureDirectory: '/tmp/pss-mgba-captures-test/instance-existing',
    })
    dockerMock.runningContainers.set('container-existing', true)
    const registry: InstanceRegistry = new Map()
    const manager = new InstanceManager(createConfig(), registry)

    await manager.reconstruct()

    const info = manager.get('instance-existing')
    expect(info?.containerId).toBe('container-existing')
    expect(info?.containerHost).toBe('pss-mgba-instance-existing')
    expect(info?.captureDirectory).toBe('/tmp/pss-mgba-captures-test/instance-existing')
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
    emulatorMemoryBytes: 805_306_368,
    captureIntervalMs: 16,
    captureRoot: '/tmp/pss-mgba-captures-test',
    streamKeyframeInterval: 60,
    streamTileSize: 16,
    wsBackpressureLimit: 262_144,
    networkName: 'pss-mgba-net',
    romPath: '/rom/default.gb',
  }
}
