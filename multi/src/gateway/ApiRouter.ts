
import { Hono } from 'hono'

import { readCaptureFile } from '../instances/capturePaths.js'
import type { InstanceInfo } from '../instances/types.js'
import type { MgbaSocketClient } from '../mgba/MgbaSocketClient.js'
import { formatMessage, SUCCESS_MARKER } from '../mgba/protocol.js'

interface InstanceEntry {
  info: InstanceInfo
  client: MgbaSocketClient
}

export type InstanceRegistry = Map<string, InstanceEntry>

interface ApiVariables {
  entry: InstanceEntry
}

interface ApiEnv {
  Variables: ApiVariables
}

const CONTAINER_CAPTURE_PATH = '/capture/rest-capture.png'
const HOST_CAPTURE_FILE = 'rest-capture.png'

interface ApiRouterOptions {
  fallbackToSingleInstance?: boolean
}

export function createApiRouter(registry: InstanceRegistry, options: ApiRouterOptions = {}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>()

  app.use('*', async (c, next) => {
    const token = c.req.param('token')
    const entry = token === undefined && options.fallbackToSingleInstance && registry.size === 1
      ? Array.from(registry.values())[0]
      : token === undefined ? undefined : registry.get(token)
    if (entry === undefined) {
      return c.text('Unauthorized', 401)
    }

    c.set('entry', entry)
    await next()
  })

  app.get('/core/currentframe', async (c) => c.text(await send(c.get('entry'), 'core.currentFrame')))

  app.get('/core/read8', async (c) => {
    const address = queryParam(c.req.query('address'), 'address')
    if (!address.ok) {
      return c.text(address.message, 400)
    }

    return c.text(await send(c.get('entry'), 'core.read8', address.value))
  })

  app.get('/core/read16', async (c) => {
    const address = queryParam(c.req.query('address'), 'address')
    if (!address.ok) {
      return c.text(address.message, 400)
    }

    return c.text(await send(c.get('entry'), 'core.read16', address.value))
  })

  app.get('/core/readrange', async (c) => {
    const address = queryParam(c.req.query('address'), 'address')
    if (!address.ok) {
      return c.text(address.message, 400)
    }

    const length = queryParam(c.req.query('length'), 'length')
    if (!length.ok) {
      return c.text(length.message, 400)
    }

    return c.text(await send(c.get('entry'), 'core.readRange', address.value, length.value))
  })

  app.post('/mgba-http/button/tap', async (c) => {
    const button = queryParam(c.req.query('button'), 'button')
    if (!button.ok) {
      return c.text(button.message, 400)
    }

    return c.text(await send(c.get('entry'), 'mgba-http.button.tap', button.value))
  })

  app.post('/mgba-http/button/hold', async (c) => {
    const button = queryParam(c.req.query('button'), 'button')
    if (!button.ok) {
      return c.text(button.message, 400)
    }

    const duration = c.req.query('duration') ?? '15'
    return c.text(await send(c.get('entry'), 'mgba-http.button.hold', button.value, duration))
  })

  app.post('/core/screenshot', async (c) => {
    const entry = c.get('entry')
    const response = await send(entry, 'core.screenshot', CONTAINER_CAPTURE_PATH)
    if (response !== SUCCESS_MARKER) {
      return c.text(response, 500)
    }

    try {
      const pngBytes = await readCaptureFile(entry.info.captureDirectory, HOST_CAPTURE_FILE)
      return c.body(new Uint8Array(pngBytes), 200, { 'content-type': 'image/png' })
    } catch {
      return c.text('Failed to read screenshot', 500)
    }
  })

  app.post('/core/savestateslot', async (c) => {
    const slot = queryParam(c.req.query('slot'), 'slot')
    if (!slot.ok) {
      return c.text(slot.message, 400)
    }

    return c.text(await send(c.get('entry'), 'core.saveStateSlot', slot.value))
  })

  app.post('/core/loadstateslot', async (c) => {
    const slot = queryParam(c.req.query('slot'), 'slot')
    if (!slot.ok) {
      return c.text(slot.message, 400)
    }

    return c.text(await send(c.get('entry'), 'core.loadStateSlot', slot.value))
  })

  return app
}

function send(entry: InstanceEntry, type: string, ...args: string[]): Promise<string> {
  return entry.client.send(formatMessage(type, ...args))
}

type QueryParamResult =
  | { ok: true; value: string }
  | { ok: false; message: string }

function queryParam(value: string | undefined, name: string): QueryParamResult {
  if (value === undefined) {
    return { ok: false, message: `Missing ${name}` }
  }

  return { ok: true, value }
}
