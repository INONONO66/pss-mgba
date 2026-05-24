import { createServer } from 'node:http'

import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { WebSocketServer } from 'ws'

import type { Config } from '../config.js'
import { DashboardBroadcast } from '../streaming/DashboardBroadcast.js'
import { FrameCapture } from '../streaming/FrameCapture.js'
import { renderDashboard } from '../dashboard/DashboardPage.js'
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
  app.get('/', (c) => c.html(renderDashboard()))
  app.get('/api/instances', (c) => {
    const instances = instanceManager.list().map((info, index) => ({
      index,
      id: info.id,
      token: info.token,
      status: info.status,
    }))

    return c.json(instances)
  })

  app.route('/admin', createAdminRouter(config, registry, instanceManager))
  app.route('/api/v1/:token', createApiRouter(registry))
  app.route('/', createApiRouter(registry, { fallbackToSingleInstance: true }))

  const httpServer = createServer(getRequestListener(app.fetch))
  const wss = new WebSocketServer({ server: httpServer })
  const broadcast = new DashboardBroadcast(wss, registry, config.wsBackpressureLimit)
  const frameCapture = new FrameCapture(registry, config.captureIntervalMs, config.jpegQuality)
  frameCapture.onFrame((frame) => broadcast.broadcastFrame(frame))

  return {
    httpServer,
    wss,
    start() {
      frameCapture.start()
      httpServer.listen(config.port, () => {
        console.log(`Gateway server running on http://localhost:${config.port}`)
      })
    },
    stop() {
      frameCapture.stop()
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
