import { loadConfig } from './config.js'
import type { InstanceRegistry } from './gateway/ApiRouter.js'
import { createGatewayServer } from './gateway/GatewayServer.js'
import { InstanceManager } from './instances/InstanceManager.js'

const config = loadConfig()
const registry: InstanceRegistry = new Map()
const instanceManager = new InstanceManager(config, registry)

await instanceManager.reconstruct().catch((err: unknown) => {
  console.warn('Could not reconstruct instances from Docker (Docker may be unavailable):', err instanceof Error ? err.message : String(err))
})
instanceManager.startHealthChecks()

const gateway = createGatewayServer(config, registry, instanceManager)
gateway.start()

process.on('SIGTERM', async () => {
  instanceManager.stopHealthChecks()
  await gateway.stop()
  process.exit(0)
})

export { gateway, instanceManager }
