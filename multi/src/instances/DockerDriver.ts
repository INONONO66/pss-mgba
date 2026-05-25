import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'

import { isPathInside } from './capturePaths.js'

import Dockerode from 'dockerode'

const LEADING_SLASH = /^\//
const CONTAINER_CAPTURE_DIR = '/capture'
const CAPTURE_DIRECTORY_MODE = 0o700

async function ensureSecureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: CAPTURE_DIRECTORY_MODE })
  const stats = await lstat(directory)
  if (!stats.isDirectory()) {
    throw new Error('Capture directory is not a directory')
  }

  const uid = process.getuid?.()
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error('Capture directory owner mismatch')
  }

  if ((stats.mode & 0o077) !== 0) {
    await chmod(directory, CAPTURE_DIRECTORY_MODE)
  }
}

async function ensureCaptureRoot(captureRoot: string): Promise<string> {
  await ensureSecureDirectory(captureRoot)
  return realpath(captureRoot)
}

function resolveCaptureDirectory(captureRoot: string, instanceId: string): string {
  const resolved = path.resolve(captureRoot, instanceId)
  if (!isPathInside(captureRoot, resolved)) {
    throw new Error('Capture directory escaped capture root')
  }

  return resolved
}

function ignoreDockerError(): void {
  return
}

export interface ContainerCreateOptions {
  image: string
  instanceId: string
  romPath?: string
  networkName: string
  emulatorPort: number
  emulatorMemoryBytes: number
  captureRoot: string
}

export interface ContainerInfo {
  id: string
  host: string
  port: number
  captureDirectory: string
}

interface ManagedContainerInfo {
  id: string
  instanceId: string
  host: string
  captureDirectory?: string
}

export class DockerDriver {
  private readonly docker: Dockerode

  constructor() {
    this.docker = new Dockerode()
  }

  async createContainer(opts: ContainerCreateOptions): Promise<ContainerInfo> {
    const containerName = `pss-mgba-${opts.instanceId}`
    const captureRoot = await ensureCaptureRoot(opts.captureRoot)
    const captureDirectory = resolveCaptureDirectory(captureRoot, opts.instanceId)
    await ensureSecureDirectory(captureDirectory)

    const mounts: Dockerode.MountConfig = [
      { Target: CONTAINER_CAPTURE_DIR, Source: captureDirectory, Type: 'bind' },
    ]
    if (opts.romPath) {
      mounts.push({ Target: '/rom/game.gb', Source: opts.romPath, Type: 'bind', ReadOnly: true })
    }

    const createOptions: Dockerode.ContainerCreateOptions = {
      Image: opts.image,
      name: containerName,
      Labels: {
        'pss-mgba.capture-directory': captureDirectory,
        'pss-mgba.instance-id': opts.instanceId,
        'pss-mgba.managed': 'true',
      },
      Env: [
        'DISPLAY=:99',
        'SDL_AUDIODRIVER=dummy',
        'XVFB_SCREEN=320x240x16',
      ],
      HostConfig: {
        NetworkMode: opts.networkName,
        PortBindings: {
          [`${opts.emulatorPort}/tcp`]: [{ HostPort: '' }],
        },
        Memory: opts.emulatorMemoryBytes,
        MemorySwap: opts.emulatorMemoryBytes,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=32m',
          '/run': 'rw,noexec,nosuid,size=8m',
        },
        ShmSize: 32 * 1024 * 1024,
        PidsLimit: 128,
        Mounts: mounts,
      },
      ExposedPorts: {
        [`${opts.emulatorPort}/tcp`]: {},
      },
    }

    let container: Dockerode.Container | undefined
    try {
      container = await this.docker.createContainer(createOptions)
      await container.start()
      const inspection = await container.inspect()
      const hostPort = inspection.NetworkSettings.Ports?.[`${opts.emulatorPort}/tcp`]?.[0]?.HostPort
      if (hostPort === undefined || hostPort === '') {
        throw new Error('Container port not bound')
      }

      const port = Number.parseInt(hostPort, 10)
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error('Container port not bound')
      }

      return {
        id: container.id,
        host: '127.0.0.1',
        port,
        captureDirectory,
      }
    } catch (error) {
      await container?.remove({ force: true }).catch(ignoreDockerError)
      await rm(captureDirectory, { force: true, recursive: true }).catch(ignoreDockerError)
      throw error
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId)
    await container.stop({ t: 5 }).catch(ignoreDockerError)
    await container.remove({ force: true })
  }

  async listManagedContainers(): Promise<ManagedContainerInfo[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ['pss-mgba.managed=true'] },
    })

    return containers.flatMap((container) => {
      const instanceId = container.Labels?.['pss-mgba.instance-id']
      const host = container.Names?.[0]?.replace(LEADING_SLASH, '')
      const captureDirectory = container.Labels?.['pss-mgba.capture-directory']
      if (
        instanceId === undefined ||
        host === undefined ||
        host === ''
      ) {
        return []
      }

      return [{ id: container.Id, instanceId, host, captureDirectory }]
    })
  }

  async inspectContainer(containerId: string): Promise<{ running: boolean }> {
    const container = this.docker.getContainer(containerId)
    const info = await container.inspect()
    return { running: info.State.Running }
  }
}
