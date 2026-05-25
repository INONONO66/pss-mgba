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

export class FrameCapture {
  private timer?: NodeJS.Timeout
  private instanceKeys: string[] = []
  private currentIndex = 0
  private readonly handlers: FrameHandler[] = []
  private readonly registry: InstanceRegistry
  private readonly captureIntervalMs: number
  private readonly jpegQuality: number

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
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => {
      this.captureNext().catch(() => undefined)
    }, this.captureIntervalMs)
  }

  stop(): void {
    if (!this.timer) {
      return
    }

    clearInterval(this.timer)
    this.timer = undefined
  }

  private async captureNext(): Promise<void> {
    this.instanceKeys = Array.from(this.registry.keys())
    if (this.instanceKeys.length === 0) {
      return
    }

    this.currentIndex %= this.instanceKeys.length
    const token = this.instanceKeys[this.currentIndex]
    this.currentIndex += 1

    if (token === undefined) {
      return
    }

    const entry = this.registry.get(token)
    if (!entry) {
      return
    }

    try {
      const path = join(entry.info.framePath, 'frame.png')
      const response = await entry.client.send(formatMessage('core.screenshot', path))
      if (response !== SUCCESS_MARKER) {
        return
      }

      const pngBuffer = await readFile(path)
      const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: this.jpegQuality }).toBuffer()
      const frame: CapturedFrame = {
        instanceIndex: this.instanceKeys.indexOf(token),
        instanceId: entry.info.id,
        token,
        jpegBuffer,
        timestampMs: Date.now(),
      }

      for (const handler of this.handlers) {
        handler(frame)
      }
    } catch {
      return
    }
  }
}
