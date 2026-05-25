import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { generateToken } from '../auth/TokenAuth.js'
import type { Config } from '../config.js'
import type { InstanceRegistry } from '../gateway/ApiRouter.js'
import { MgbaSocketClient } from '../mgba/MgbaSocketClient.js'
import { ProcessDriver } from './ProcessDriver.js'
import type { InstanceInfo } from './types.js'

const SOCKET_READY_TIMEOUT_MS = 30_000
const SOCKET_READY_POLL_MS = 500
const HEALTH_CHECK_INTERVAL_MS = 10_000

export class InstanceManager {
  private readonly instances = new Map<string, InstanceInfo>()
  private readonly clients = new Map<string, MgbaSocketClient>()
  private readonly processes = new Map<string, ChildProcess>()
  private readonly usedPorts = new Set<number>()
  private readonly config: Config
  private readonly registry: InstanceRegistry
  private readonly driver: ProcessDriver
  private healthCheckInterval?: NodeJS.Timeout

  constructor(
    config: Config,
    registry: InstanceRegistry,
  ) {
    this.config = config
    this.registry = registry
    this.driver = new ProcessDriver()
  }

  async create(romPath?: string): Promise<InstanceInfo> {
    if (this.instances.size >= this.config.maxInstances) {
      throw new Error('MAX_INSTANCES_REACHED')
    }

    const id = randomUUID()
    const token = generateToken()
    const resolvedRomPath = romPath ?? this.config.romPath
    if (!resolvedRomPath) {
      throw new Error('ROM_PATH_REQUIRED')
    }

    const port = this.allocatePort()
    const framePath = join(this.config.frameDir, id)
    let spawnedPid: number | undefined

    try {
      const processInfo = await this.driver.spawn({
        instanceId: id,
        romPath: resolvedRomPath,
        port,
        mgbaBinary: this.config.mgbaBinary,
        luaScriptPath: this.config.luaScriptPath,
        frameDir: this.config.frameDir,
      })
      spawnedPid = processInfo.pid

      const client = new MgbaSocketClient()
      await this.waitForSocket(client, '127.0.0.1', processInfo.port)

      const info: InstanceInfo = {
        id,
        token,
        pid: processInfo.pid,
        port: processInfo.port,
        framePath,
        status: 'running',
        createdAt: new Date(),
      }

      processInfo.process.on('exit', () => {
        this.markDead(id)
      })

      this.instances.set(id, info)
      this.clients.set(id, client)
      this.processes.set(id, processInfo.process)
      this.registry.set(token, { info, client })

      return info
    } catch (error) {
      this.usedPorts.delete(port)
      if (spawnedPid !== undefined) {
        await this.driver.kill(spawnedPid).catch(() => undefined)
      }
      throw error
    }
  }

  async destroy(instanceId: string): Promise<void> {
    const info = this.instances.get(instanceId)
    if (!info) {
      return
    }

    this.clients.get(instanceId)?.disconnect()
    await this.driver.kill(info.pid).catch(() => undefined)
    this.usedPorts.delete(info.port)

    this.instances.delete(instanceId)
    this.clients.delete(instanceId)
    this.processes.delete(instanceId)
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
    console.info('Process-based instances are not reconstructed across gateway restarts')
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

  private allocatePort(): number {
    for (let offset = 0; offset < this.config.maxInstances; offset += 1) {
      const port = this.config.baseLuaPort + offset
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port)
        return port
      }
    }

    throw new Error('NO_PORT_AVAILABLE')
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
