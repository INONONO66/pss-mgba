import { inflateRawSync } from 'node:zlib'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstanceRegistry } from '../src/gateway/ApiRouter.js'
import { SUCCESS_MARKER } from '../src/mgba/protocol.js'
import { encodeFrame } from '../src/streaming/DashboardBroadcast.js'
import { FrameCapture, type CapturedFrame } from '../src/streaming/FrameCapture.js'
import { decodeStreamFrame, StreamFrameType } from '../src/streaming/StreamProtocol.js'

const readCaptureFileMock = vi.hoisted(() => ({
  readCaptureFile: vi.fn(() => Promise.resolve(Buffer.from('png'))),
}))

const sharpMock = vi.hoisted(() => ({
  sharp: vi.fn(() => ({
    ensureAlpha() {
      return this
    },
    raw() {
      return this
    },
    toBuffer() {
      return Promise.resolve({
        data: Buffer.from([0, 0, 0, 255]),
        info: { width: 1, height: 1 },
      })
    },
  })),
}))

vi.mock('../src/instances/capturePaths.js', () => ({
  readCaptureFile: readCaptureFileMock.readCaptureFile,
}))

vi.mock('sharp', () => ({
  default: sharpMock.sharp,
}))

describe('FrameCapture', () => {
  beforeEach(() => {
    readCaptureFileMock.readCaptureFile.mockClear()
    sharpMock.sharp.mockClear()
  })

  it('emits cached repeat deltas while source screenshot capture is still in flight', async () => {
    const sentMessages: string[] = []
    const firstClient = {
      send: vi.fn((message: string) => {
        sentMessages.push(message)
        return Promise.resolve(SUCCESS_MARKER)
      }),
    }
    const registry: InstanceRegistry = new Map([
      [
        'token-a',
        {
          info: {
            id: 'instance-a',
            token: 'token-a',
            containerId: 'container-a',
            containerHost: '127.0.0.1',
            captureDirectory: '/tmp/pss-mgba-captures-test/instance-a',
            status: 'running',
            createdAt: new Date('2026-05-25T00:00:00Z'),
          },
          client: firstClient as never,
        },
      ],
    ])
    const capture = new FrameCapture(registry, 16, 250, 60, 16)
    const frames: CapturedFrame[] = []
    capture.onFrame((frame) => frames.push(frame))
    const captureOne = (capture as unknown as {
      captureOne(token: string, instanceIndex: number): Promise<void>
    }).captureOne.bind(capture)

    await captureOne('token-a', 0)
    expect(frames).toMatchObject([{ frameType: StreamFrameType.Keyframe, sequence: 1 }])

    capture.forceKeyframe('token-a')
    const deferred = createDeferred<string>()
    firstClient.send.mockImplementation((message: string) => {
      sentMessages.push(message)
      return deferred.promise
    })

    const inFlight = captureOne('token-a', 0)
    await Promise.resolve()
    await captureOne('token-a', 0)

    const repeatFrame = frames.at(-1)
    expect(repeatFrame).toMatchObject({
      frameType: StreamFrameType.Delta,
      sequence: 2,
      changedTiles: 0,
    })
    if (!repeatFrame) {
      throw new Error('expected repeat frame')
    }
    const repeatEnvelope = decodeStreamFrame(encodeFrame(repeatFrame))
    expect(repeatEnvelope?.payload.byteLength).toBeGreaterThan(0)
    expect(inflateRawSync(repeatEnvelope?.payload ?? Buffer.alloc(0))).toEqual(Buffer.from([0, 0]))
    expect(firstClient.send).toHaveBeenCalledTimes(2)

    deferred.resolve(SUCCESS_MARKER)
    await inFlight

    expect(frames).toMatchObject([
      { frameType: StreamFrameType.Keyframe, sequence: 1 },
      { frameType: StreamFrameType.Delta, sequence: 2, changedTiles: 0 },
      { frameType: StreamFrameType.Keyframe, sequence: 3 },
    ])
    expect(sentMessages).toHaveLength(2)
  })
})

function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
