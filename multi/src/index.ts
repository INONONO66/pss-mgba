import { randomUUID } from 'node:crypto'

import { generateToken } from './auth/TokenAuth.js'
import { loadConfig } from './config.js'
import type { IInstanceManager } from './gateway/AdminRouter.js'
import type { InstanceRegistry } from './gateway/ApiRouter.js'
import { createGatewayServer } from './gateway/GatewayServer.js'
import type { InstanceInfo } from './instances/types.js'
import { MgbaSocketClient } from './mgba/MgbaSocketClient.js'

const config = loadConfig()
const registry: InstanceRegistry = new Map()
const instances = new Map<string, InstanceInfo>()

const stubInstanceManager: IInstanceManager = {
  create(_romPath?: string): Promise<InstanceInfo> {
    const id = randomUUID()
    const token = generateToken()
    const info: InstanceInfo = {
      id,
      token,
      containerId: `stub-${id}`,
      containerHost: 'localhost',
      status: 'running',
      createdAt: new Date(),
    }

    instances.set(id, info)
    registry.set(token, { info, client: new MgbaSocketClient() })
    return Promise.resolve(info)
  },
  destroy(instanceId: string): Promise<void> {
    const instance = instances.get(instanceId)
    if (instance) {
      registry.delete(instance.token)
    }

    instances.delete(instanceId)
    return Promise.resolve()
  },
  list(): InstanceInfo[] {
    return Array.from(instances.values())
  },
  get(instanceId: string): InstanceInfo | undefined {
    return instances.get(instanceId)
  },
}

const gateway = createGatewayServer(config, registry, stubInstanceManager)
gateway.start()

export { gateway }
