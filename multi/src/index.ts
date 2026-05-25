import { loadConfig } from './config.js'
import type { InstanceRegistry } from './gateway/ApiRouter.js'
import { createGatewayServer } from './gateway/GatewayServer.js'
import { InstanceManager } from './instances/InstanceManager.js'

const config = loadConfig()
if (config.adminToken === 'dev-admin-token') {
  console.warn('WARNING: Using default admin token. Set ADMIN_TOKEN env var in production.')
}

const registry: InstanceRegistry = new Map()
const instanceManager = new InstanceManager(config, registry)

instanceManager.startHealthChecks()

const gateway = createGatewayServer(config, registry, instanceManager)
gateway.start()

process.on('SIGTERM', async () => {
  instanceManager.stopHealthChecks()
  await gateway.stop().catch((err: unknown) => {
    console.error('Shutdown error:', err instanceof Error ? err.message : String(err))
  })
  process.exit(0)
})

export { gateway, instanceManager }
