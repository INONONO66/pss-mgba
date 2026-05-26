import { chmod, mkdir, realpath, rm } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DockerDriver } from '../src/instances/DockerDriver.js'

interface LstatMockStats {
  isDirectory(): boolean
  mode: number
  uid: number
}

function directoryStats(mode = 0o700): LstatMockStats {
  return {
    isDirectory: () => true,
    mode,
    uid: process.getuid?.() ?? 501,
  }
}

const fsMock = vi.hoisted(() => {
  const defaultStats = {
    isDirectory: () => true,
    mode: 0o700,
    uid: process.getuid?.() ?? 501,
  }

  return {
    chmod: vi.fn(() => Promise.resolve()),
    lstat: vi.fn<() => Promise<LstatMockStats>>(() => Promise.resolve(defaultStats)),
    mkdir: vi.fn(() => Promise.resolve()),
    realpath: vi.fn((value: string) => Promise.resolve(value)),
    rm: vi.fn(() => Promise.resolve()),
  }
})

const dockerMock = vi.hoisted(() => {
  const createOptions: unknown[] = []
  const started: string[] = []
  const inspected: string[] = []
  const removed: string[] = []
  let inspectResponse: unknown = { NetworkSettings: { Ports: { '8888/tcp': [{ HostPort: '49152' }] } } }
  let startError: Error | undefined

  class Dockerode {
    createContainer(options: unknown) {
      createOptions.push(options)
      return Promise.resolve({
        id: 'container-created',
        start() {
          started.push('container-created')
          return startError ? Promise.reject(startError) : Promise.resolve()
        },
        inspect() {
          inspected.push('container-created')
          return Promise.resolve(inspectResponse)
        },
        remove() {
          removed.push('container-created')
          return Promise.resolve()
        },
      })
    }
  }

  return {
    Dockerode,
    createOptions,
    inspected,
    reset() {
      createOptions.length = 0
      inspected.length = 0
      removed.length = 0
      started.length = 0
      inspectResponse = { NetworkSettings: { Ports: { '8888/tcp': [{ HostPort: '49152' }] } } }
      startError = undefined
    },
    removed,
    setInspectResponse(response: unknown) {
      inspectResponse = response
    },
    setStartError(error: Error) {
      startError = error
    },
    started,
  }
})

vi.mock('node:fs/promises', () => ({
  chmod: fsMock.chmod,
  lstat: fsMock.lstat,
  mkdir: fsMock.mkdir,
  realpath: fsMock.realpath,
  rm: fsMock.rm,
}))

vi.mock('dockerode', () => ({
  default: dockerMock.Dockerode,
}))

describe('DockerDriver', () => {
  beforeEach(() => {
    dockerMock.reset()
    fsMock.chmod.mockClear()
    fsMock.lstat.mockReset()
    fsMock.lstat.mockResolvedValue(directoryStats())
    fsMock.mkdir.mockClear()
    fsMock.realpath.mockClear()
    fsMock.rm.mockClear()
  })

  it('creates emulator containers with host-mounted capture storage and bounded runtime resources', async () => {
    const driver = new DockerDriver()

    const info = await driver.createContainer({
      image: 'pss-mgba-emulator',
      instanceId: 'instance-a',
      token: 'token-a',
      romPath: '/rom/game.gb',
      networkName: 'pss-mgba-net',
      emulatorPort: 8888,
      emulatorMemoryBytes: 805_306_368,
      captureRoot: '/tmp/pss-mgba-captures-test',
    })

    expect(mkdir).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test', { recursive: true, mode: 0o700 })
    expect(realpath).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test')
    expect(mkdir).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test/instance-a', { recursive: true, mode: 0o700 })
    expect(chmod).not.toHaveBeenCalled()
    expect(info).toEqual({
      id: 'container-created',
      host: '127.0.0.1',
      port: 49152,
      captureDirectory: '/tmp/pss-mgba-captures-test/instance-a',
    })
    expect(dockerMock.started).toEqual(['container-created'])
    expect(dockerMock.inspected).toEqual(['container-created'])
    expect(dockerMock.createOptions[0]).toMatchObject({
      Image: 'pss-mgba-emulator',
      Labels: {
        'pss-mgba.capture-directory': '/tmp/pss-mgba-captures-test/instance-a',
        'pss-mgba.managed': 'true',
        'pss-mgba.token': 'token-a',
      },
      Env: ['DISPLAY=:99', 'SDL_AUDIODRIVER=dummy', 'XVFB_SCREEN=320x240x16'],
      HostConfig: {
        Mounts: [
          { Target: '/capture', Source: '/tmp/pss-mgba-captures-test/instance-a', Type: 'bind' },
          { Target: '/rom/game.gb', Source: '/rom/game.gb', Type: 'bind', ReadOnly: true },
        ],
        Memory: 805_306_368,
        MemorySwap: 805_306_368,
        PidsLimit: 128,
        ShmSize: 33_554_432,
        Tmpfs: {
          '/run': 'rw,noexec,nosuid,size=8m',
          '/tmp': 'rw,noexec,nosuid,size=32m',
        },
      },
    })
  })

  it('cleans up the container and capture directory when port inspection fails', async () => {
    dockerMock.setInspectResponse({ NetworkSettings: { Ports: {} } })
    const driver = new DockerDriver()

    await expect(driver.createContainer({
      image: 'pss-mgba-emulator',
      instanceId: 'instance-a',
      token: 'token-a',
      networkName: 'pss-mgba-net',
      emulatorPort: 8888,
      emulatorMemoryBytes: 805_306_368,
      captureRoot: '/tmp/pss-mgba-captures-test',
    })).rejects.toThrow('Container port not bound')

    expect(dockerMock.removed).toEqual(['container-created'])
    expect(rm).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test/instance-a', { force: true, recursive: true })
  })


  it('cleans up the container and capture directory when start fails', async () => {
    dockerMock.setStartError(new Error('start failed'))
    const driver = new DockerDriver()

    await expect(driver.createContainer({
      image: 'pss-mgba-emulator',
      instanceId: 'instance-a',
      token: 'token-a',
      networkName: 'pss-mgba-net',
      emulatorPort: 8888,
      emulatorMemoryBytes: 805_306_368,
      captureRoot: '/tmp/pss-mgba-captures-test',
    })).rejects.toThrow('start failed')

    expect(dockerMock.removed).toEqual(['container-created'])
    expect(rm).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test/instance-a', { force: true, recursive: true })
  })

  it('tightens permissive capture directory permissions before mounting', async () => {
    fsMock.lstat.mockResolvedValue(directoryStats(0o755))
    const driver = new DockerDriver()

    await driver.createContainer({
      image: 'pss-mgba-emulator',
      instanceId: 'instance-a',
      token: 'token-a',
      networkName: 'pss-mgba-net',
      emulatorPort: 8888,
      emulatorMemoryBytes: 805_306_368,
      captureRoot: '/tmp/pss-mgba-captures-test',
    })

    expect(chmod).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test', 0o700)
    expect(chmod).toHaveBeenCalledWith('/tmp/pss-mgba-captures-test/instance-a', 0o700)
  })

  it('rejects capture roots that are not real directories', async () => {
    fsMock.lstat.mockResolvedValue({
      isDirectory: () => false,
      mode: 0o700,
      uid: process.getuid?.() ?? 501,
    })
    const driver = new DockerDriver()

    await expect(driver.createContainer({
      image: 'pss-mgba-emulator',
      instanceId: 'instance-a',
      token: 'token-a',
      networkName: 'pss-mgba-net',
      emulatorPort: 8888,
      emulatorMemoryBytes: 805_306_368,
      captureRoot: '/tmp/pss-mgba-captures-test',
    })).rejects.toThrow('Capture directory is not a directory')
    expect(dockerMock.createOptions).toHaveLength(0)
  })
})
