import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Gateway server running on http://localhost:${info.port}`)
})

export { server }
