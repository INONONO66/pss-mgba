import { createServer } from 'node:http'

import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { WebSocketServer } from 'ws'

import type { Config } from '../config.js'
import { createAdminRouter, type IInstanceManager } from './AdminRouter.js'
import { createApiRouter, type InstanceRegistry } from './ApiRouter.js'

export interface GatewayServer {
  httpServer: ReturnType<typeof createServer>
  wss: WebSocketServer
  start(): void
  stop(): Promise<void>
}

export function createGatewayServer(
  config: Config,
  registry: InstanceRegistry,
  instanceManager: IInstanceManager,
): GatewayServer {
  const app = new Hono()

  app.use('*', logger())
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get(
    '/',
    (c) => c.html('<html><body><h1>mGBA Gateway Dashboard</h1><p>Coming soon...</p></body></html>'),
  )

  app.route('/admin', createAdminRouter(config, registry, instanceManager))
  app.route('/api/v1/:token', createApiRouter(registry))
  app.route('/', createApiRouter(registry, { fallbackToSingleInstance: true }))

  const httpServer = createServer(getRequestListener(app.fetch))
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws, req) => {
    const url = req.url ?? ''
    if (url.startsWith('/ws/dashboard')) {
      ws.send(JSON.stringify({ type: 'connected', message: 'Dashboard WS connected' }))
      return
    }

    if (url.startsWith('/ws/instance/')) {
      const token = url.replace('/ws/instance/', '')
      const entry = registry.get(token)
      if (!entry) {
        ws.close(4001, 'Unknown token')
        return
      }

      ws.send(JSON.stringify({ type: 'connected', instanceId: entry.info.id }))
      return
    }

    ws.close(4000, 'Unknown endpoint')
  })

  return {
    httpServer,
    wss,
    start() {
      httpServer.listen(config.port, () => {
        console.log(`Gateway server running on http://localhost:${config.port}`)
      })
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        wss.close(() => {
          httpServer.close((error) => {
            if (error) {
              reject(error)
              return
            }

            resolve()
          })
        })
      })
    },
  }
}
