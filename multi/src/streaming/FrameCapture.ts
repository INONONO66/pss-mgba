import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import sharp from 'sharp'

import type { InstanceRegistry } from '../gateway/ApiRouter.js'
import { formatMessage, SUCCESS_MARKER } from '../mgba/protocol.js'

export interface CapturedFrame {
  instanceIndex: number
  instanceId: string
  token: string
  jpegBuffer: Buffer
  timestampMs: number
}

export type FrameHandler = (frame: CapturedFrame) => void

const MAX_CONCURRENT_CAPTURES = 10

export class FrameCapture {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly inFlight = new Set<string>()
  private readonly handlers: FrameHandler[] = []
  private readonly registry: InstanceRegistry
  private readonly captureIntervalMs: number
  private readonly jpegQuality: number
  private syncTimer?: NodeJS.Timeout

  constructor(
    registry: InstanceRegistry,
    captureIntervalMs: number,
    jpegQuality: number,
  ) {
    this.registry = registry
    this.captureIntervalMs = captureIntervalMs
    this.jpegQuality = jpegQuality
  }

  onFrame(handler: FrameHandler): void {
    this.handlers.push(handler)
  }

  start(): void {
    if (this.syncTimer) return
    this.syncTimer = setInterval(() => this.syncInstances(), 1000)
    this.syncInstances()
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = undefined
    }
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
    this.inFlight.clear()
  }

  private syncInstances(): void {
    const activeTokens = new Set(this.registry.keys())

    for (const token of this.timers.keys()) {
      if (!activeTokens.has(token)) {
        clearInterval(this.timers.get(token)!)
        this.timers.delete(token)
        this.inFlight.delete(token)
      }
    }

    for (const token of activeTokens) {
      if (!this.timers.has(token)) {
        const timer = setInterval(() => {
          this.captureInstance(token).catch(() => undefined)
        }, this.captureIntervalMs)
        this.timers.set(token, timer)
      }
    }
  }

  private async captureInstance(token: string): Promise<void> {
    if (this.inFlight.has(token)) return
    if (this.inFlight.size >= MAX_CONCURRENT_CAPTURES) return

    const entry = this.registry.get(token)
    if (!entry) return

    this.inFlight.add(token)
    try {
      const path = join(entry.info.framePath, 'frame.png')
      const response = await entry.client.send(formatMessage('core.screenshot', path))
      if (response !== SUCCESS_MARKER) return

      const pngBuffer = await readFile(path)
      const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: this.jpegQuality }).toBuffer()

      const tokens = Array.from(this.registry.keys())
      const frame: CapturedFrame = {
        instanceIndex: tokens.indexOf(token),
        instanceId: entry.info.id,
        token,
        jpegBuffer,
        timestampMs: Date.now(),
      }

      for (const handler of this.handlers) {
        handler(frame)
      }
    } catch {
      // skip failed captures
    } finally {
      this.inFlight.delete(token)
    }
  }
}
