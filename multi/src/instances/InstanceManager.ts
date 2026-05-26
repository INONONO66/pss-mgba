import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { generateToken } from '../auth/TokenAuth.js'
import type { Config } from '../config.js'
import type { InstanceRegistry } from '../gateway/ApiRouter.js'
import { MgbaSocketClient } from '../mgba/MgbaSocketClient.js'
import { DockerDriver } from './DockerDriver.js'
import { isSafeCaptureDirectory } from './capturePaths.js'
import type { InstanceInfo } from './types.js'

const SOCKET_READY_TIMEOUT_MS = 30_000
const SOCKET_READY_POLL_MS = 500
const HEALTH_CHECK_INTERVAL_MS = 10_000

export class InstanceManager {
  private readonly instances = new Map<string, InstanceInfo>()
  private readonly clients = new Map<string, MgbaSocketClient>()
  private readonly config: Config
  private readonly registry: InstanceRegistry
  private readonly driver: DockerDriver
  private healthCheckInterval?: NodeJS.Timeout

  constructor(
    config: Config,
    registry: InstanceRegistry,
  ) {
    this.config = config
    this.registry = registry
    this.driver = new DockerDriver()
  }

  async create(romPath?: string): Promise<InstanceInfo> {
    if (this.instances.size >= this.config.maxInstances) {
      throw new Error('MAX_INSTANCES_REACHED')
    }

    const id = randomUUID()
    const token = generateToken()
    const containerInfo = await this.driver.createContainer({
      image: this.config.emulatorImage,
      instanceId: id,
      token,
      romPath: romPath ?? this.config.romPath,
      networkName: this.config.networkName,
      emulatorPort: this.config.emulatorPort,
      emulatorMemoryBytes: this.config.emulatorMemoryBytes,
      captureRoot: this.config.captureRoot,
    })

    const client = new MgbaSocketClient()
    try {
      await this.waitForSocket(client, containerInfo.host, containerInfo.port)
    } catch (error) {
      client.disconnect()
      await this.driver.stopContainer(containerInfo.id).catch(() => undefined)
      if (await isSafeCaptureDirectory(containerInfo.captureDirectory, this.config.captureRoot)) {
        await rm(containerInfo.captureDirectory, { force: true, recursive: true }).catch(() => undefined)
      }
      throw error
    }

    const info: InstanceInfo = {
      id,
      token,
      containerId: containerInfo.id,
      containerHost: containerInfo.host,
      captureDirectory: containerInfo.captureDirectory,
      status: 'running',
      createdAt: new Date(),
    }

    this.instances.set(id, info)
    this.clients.set(id, client)
    this.registry.set(token, { info, client })

    return info
  }

  async destroy(instanceId: string): Promise<void> {
    const info = this.instances.get(instanceId)
    if (!info) {
      return
    }

    this.clients.get(instanceId)?.disconnect()
    await this.driver.stopContainer(info.containerId).catch(() => undefined)
    if (await isSafeCaptureDirectory(info.captureDirectory, this.config.captureRoot)) {
      await rm(info.captureDirectory, { force: true, recursive: true }).catch(() => undefined)
    }

    this.instances.delete(instanceId)
    this.clients.delete(instanceId)
    this.registry.delete(info.token)
  }

  list(): InstanceInfo[] {
    return Array.from(this.instances.values())
  }

  get(instanceId: string): InstanceInfo | undefined {
    return this.instances.get(instanceId)
  }

  getByToken(token: string): InstanceInfo | undefined {
    return this.registry.get(token)?.info
  }

  async reconstruct(): Promise<void> {
    const containers = await this.driver.listManagedContainers()
    for (const container of containers) {
      if (this.instances.size >= this.config.maxInstances) {
        return
      }

      if (container.captureDirectory === undefined ||
        !(await isSafeCaptureDirectory(container.captureDirectory, this.config.captureRoot))
      ) {
        await this.driver.stopContainer(container.id).catch(() => undefined)
        continue
      }

      const inspection = await this.driver.inspectContainer(container.id).catch(() => ({ running: false }))
      if (!inspection.running) {
        continue
      }

      const token = container.token
      if (token === undefined || token === '') {
        continue
      }

      const client = new MgbaSocketClient()
      await this.waitForSocket(client, container.host, this.config.emulatorPort).catch(() => {
        client.disconnect()
      })

      if (!client.isConnected()) {
        continue
      }

      const info: InstanceInfo = {
        id: container.instanceId,
        token,
        containerId: container.id,
        containerHost: container.host,
        captureDirectory: container.captureDirectory,
        status: 'running',
        createdAt: new Date(),
      }

      this.instances.set(container.instanceId, info)
      this.clients.set(container.instanceId, client)
      this.registry.set(token, { info, client })
    }
  }

  startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.checkHealth()
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  private async checkHealth(): Promise<void> {
    for (const [instanceId, client] of this.clients) {
      try {
        const alive = await client.ping()
        if (!alive) {
          this.markDead(instanceId)
        }
      } catch {
        this.markDead(instanceId)
      }
    }
  }

  private markDead(instanceId: string): void {
    const info = this.instances.get(instanceId)
    if (info) {
      info.status = 'error'
    }
  }

  private async waitForSocket(
    client: MgbaSocketClient,
    host: string,
    port: number,
    timeoutMs = SOCKET_READY_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        await client.connect(host, port)
        const alive = await client.ping()
        if (alive) {
          return
        }
      } catch {
        client.disconnect()
      }

      await new Promise((resolve) => setTimeout(resolve, SOCKET_READY_POLL_MS))
    }

    throw new Error(`Lua socket not ready after ${timeoutMs}ms`)
  }
}
