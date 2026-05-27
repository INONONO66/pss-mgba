import { deflateRawSync } from 'node:zlib'

import sharp from 'sharp'

import { readCaptureFile } from '../instances/capturePaths.js'

import type { InstanceRegistry } from '../gateway/ApiRouter.js'
import { formatMessage, SUCCESS_MARKER } from '../mgba/protocol.js'
import { StreamFrameType } from './StreamProtocol.js'

const CONTAINER_CAPTURE_PATH = '/capture/frame.png'
const HOST_CAPTURE_FILE = 'frame.png'
const BYTES_PER_PIXEL = 4
const DELTA_RECORD_HEADER_BYTES = 8
const EMPTY_DELTA_PAYLOAD = deflateRawSync(Buffer.alloc(2), { level: 1 })

export interface CapturedFrame {
  changedTiles: number
  frameType: StreamFrameType
  height: number
  instanceIndex: number
  instanceId: string
  payload: Buffer
  payloadBytes: number
  rawBytes: number
  sequence: number
  tileSize: number
  timestampMs: number
  token: string
  width: number
}

type FrameHandler = (frame: CapturedFrame) => void

interface PreviousFrameState {
  forceKeyframe: boolean
  height: number
  raw: Buffer
  sequence: number
  sourceCaptureCount: number
  sourceCapturedAtMs: number
  width: number
}

export class FrameCapture {
  private timer?: NodeJS.Timeout
  private instanceKeys: string[] = []
  private readonly handlers: FrameHandler[] = []
  private readonly inFlightTokens = new Set<string>()
  private readonly previousFrames = new Map<string, PreviousFrameState>()
  private readonly registry: InstanceRegistry
  private readonly captureIntervalMs: number
  private readonly sourceCaptureIntervalMs: number
  private readonly keyframeInterval: number
  private readonly tileSize: number

  constructor(
    registry: InstanceRegistry,
    captureIntervalMs: number,
    sourceCaptureIntervalMs: number,
    keyframeInterval: number,
    tileSize: number,
  ) {
    this.registry = registry
    this.captureIntervalMs = captureIntervalMs
    this.sourceCaptureIntervalMs = sourceCaptureIntervalMs
    this.keyframeInterval = keyframeInterval
    this.tileSize = tileSize
  }

  onFrame(handler: FrameHandler): void {
    this.handlers.push(handler)
  }

  forceKeyframe(token?: string): void {
    if (token !== undefined) {
      const entry = this.registry.get(token)
      if (entry) {
        const previous = this.previousFrames.get(entry.info.id)
        if (previous) {
          previous.forceKeyframe = true
        }
      }
      return
    }

    for (const previous of this.previousFrames.values()) {
      previous.forceKeyframe = true
    }
  }

  start(): void {
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => {
      this.captureAll().catch(() => undefined)
    }, this.captureIntervalMs)
  }

  stop(): void {
    if (!this.timer) {
      return
    }

    clearInterval(this.timer)
    this.timer = undefined
  }

  private async captureAll(): Promise<void> {
    this.instanceKeys = Array.from(this.registry.keys())
    await Promise.all(
      this.instanceKeys.map((token, instanceIndex) => this.captureOne(token, instanceIndex))
    )
  }

  private async captureOne(token: string, instanceIndex: number): Promise<void> {
    if (this.inFlightTokens.has(token)) {
      this.emitRepeatFrame(token, instanceIndex)
      return
    }

    const entry = this.registry.get(token)
    if (!entry) {
      return
    }

    const previous = this.previousFrames.get(entry.info.id)
    const dueForSourceCapture = previous === undefined ||
      previous.forceKeyframe ||
      Date.now() - previous.sourceCapturedAtMs >= this.sourceCaptureIntervalMs
    if (!dueForSourceCapture) {
      this.emitRepeatFrame(token, instanceIndex)
      return
    }

    this.inFlightTokens.add(token)
    try {
      const response = await entry.client.send(formatMessage('core.screenshot', CONTAINER_CAPTURE_PATH))
      if (response !== SUCCESS_MARKER) {
        return
      }

      const pngBuffer = await readCaptureFile(entry.info.captureDirectory, HOST_CAPTURE_FILE)
      const decoded = await sharp(pngBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const raw = decoded.data
      const width = decoded.info.width
      const height = decoded.info.height
      const timestampMs = Date.now()
      const previous = this.previousFrames.get(entry.info.id)
      const sequence = (previous?.sequence ?? 0) + 1
      const sourceCaptureCount = (previous?.sourceCaptureCount ?? 0) + 1
      const dimensionsChanged = previous?.width !== width || previous?.height !== height
      const forceKeyframe = previous?.forceKeyframe ?? false
      const periodicKeyframe = sourceCaptureCount % this.keyframeInterval === 0
      const isKeyframe = !previous || dimensionsChanged || forceKeyframe || periodicKeyframe
      const encoded = isKeyframe
        ? encodeKeyframe(raw)
        : encodeDelta(previous.raw, raw, width, height, this.tileSize)

      this.previousFrames.set(entry.info.id, {
        forceKeyframe: false,
        height,
        raw: Buffer.from(raw),
        sequence,
        sourceCaptureCount,
        sourceCapturedAtMs: timestampMs,
        width,
      })

      const frame: CapturedFrame = {
        changedTiles: encoded.changedTiles,
        frameType: isKeyframe ? StreamFrameType.Keyframe : StreamFrameType.Delta,
        height,
        instanceIndex,
        instanceId: entry.info.id,
        payload: encoded.payload,
        payloadBytes: encoded.payload.byteLength,
        rawBytes: raw.byteLength,
        sequence,
        tileSize: this.tileSize,
        timestampMs,
        token,
        width,
      }

      for (const handler of this.handlers) {
        handler(frame)
      }
    } catch {
      return
    } finally {
      this.inFlightTokens.delete(token)
    }
  }

  private emitRepeatFrame(token: string, instanceIndex: number): void {
    const entry = this.registry.get(token)
    if (!entry) {
      return
    }

    const previous = this.previousFrames.get(entry.info.id)
    if (!previous) {
      return
    }

    const sequence = previous.sequence + 1
    this.previousFrames.set(entry.info.id, {
      ...previous,
      sequence,
    })

    const frame: CapturedFrame = {
      changedTiles: 0,
      frameType: StreamFrameType.Delta,
      height: previous.height,
      instanceIndex,
      instanceId: entry.info.id,
      payload: EMPTY_DELTA_PAYLOAD,
      payloadBytes: EMPTY_DELTA_PAYLOAD.byteLength,
      rawBytes: previous.raw.byteLength,
      sequence,
      tileSize: this.tileSize,
      timestampMs: Date.now(),
      token,
      width: previous.width,
    }

    for (const handler of this.handlers) {
      handler(frame)
    }
  }
}

function encodeKeyframe(raw: Buffer): { changedTiles: number; payload: Buffer } {
  return { changedTiles: 0, payload: deflateRawSync(raw, { level: 1 }) }
}

function encodeDelta(
  previous: Buffer,
  current: Buffer,
  width: number,
  height: number,
  tileSize: number,
): { changedTiles: number; payload: Buffer } {
  const tiles: Buffer[] = []
  let changedTiles = 0

  for (let y = 0; y < height; y += tileSize) {
    const tileHeight = Math.min(tileSize, height - y)
    for (let x = 0; x < width; x += tileSize) {
      const tileWidth = Math.min(tileSize, width - x)
      if (!tileChanged(previous, current, width, x, y, tileWidth, tileHeight)) {
        continue
      }

      changedTiles += 1
      const header = Buffer.allocUnsafe(DELTA_RECORD_HEADER_BYTES)
      header.writeUInt16BE(x, 0)
      header.writeUInt16BE(y, 2)
      header.writeUInt16BE(tileWidth, 4)
      header.writeUInt16BE(tileHeight, 6)
      tiles.push(header, copyTile(current, width, x, y, tileWidth, tileHeight))
    }
  }

  const tileCount = Buffer.allocUnsafe(2)
  tileCount.writeUInt16BE(changedTiles, 0)
  return { changedTiles, payload: deflateRawSync(Buffer.concat([tileCount, ...tiles]), { level: 1 }) }
}

function tileChanged(
  previous: Buffer,
  current: Buffer,
  width: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
): boolean {
  const rowBytes = tileWidth * BYTES_PER_PIXEL
  for (let row = 0; row < tileHeight; row += 1) {
    const offset = ((y + row) * width + x) * BYTES_PER_PIXEL
    if (!previous.subarray(offset, offset + rowBytes).equals(current.subarray(offset, offset + rowBytes))) {
      return true
    }
  }
  return false
}

function copyTile(
  source: Buffer,
  width: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
): Buffer {
  const rowBytes = tileWidth * BYTES_PER_PIXEL
  const tile = Buffer.allocUnsafe(rowBytes * tileHeight)
  for (let row = 0; row < tileHeight; row += 1) {
    const sourceOffset = ((y + row) * width + x) * BYTES_PER_PIXEL
    const targetOffset = row * rowBytes
    source.copy(tile, targetOffset, sourceOffset, sourceOffset + rowBytes)
  }
  return tile
}
