import { describe, expect, it } from "vitest";

import type { CapturedFrame } from "../src/streaming/FrameCapture.js";
import { StreamMetrics } from "../src/streaming/StreamMetrics.js";
import { StreamFrameType } from "../src/streaming/StreamProtocol.js";

describe("StreamMetrics", () => {
  it("records produced cadence, protocol health, compression, and delivery drops", () => {
    const metrics = new StreamMetrics();
    const first = createFrame({ timestampMs: 1000, sequence: 1 });
    const second = createFrame({ frameType: StreamFrameType.Delta, timestampMs: 2000, sequence: 3, payloadBytes: 5 });

    metrics.recordProduced(first);
    metrics.recordProduced(second);
    metrics.recordDelivery(second, "dashboard", true);
    metrics.recordDelivery(second, "dashboard", false);
    metrics.recordDelivery(second, "instance", true);
    metrics.recordClientMetrics("instance-a", { renderedFrames: 2, sequenceGaps: 1, fps: 59.5 });

    expect(metrics.snapshot(3000)).toEqual({
      generatedAtMs: 3000,
      instances: [
        {
          instanceId: "instance-a",
          instanceIndex: 2,
          producedFrames: 2,
          firstProducedAtMs: 1000,
          lastProducedAtMs: 2000,
          producedFps: 1,
          rawBytes: 20,
          compressedBytes: 15,
          compressionRatio: 0.75,
          keyframesProduced: 1,
          deltaFrames: 1,
          sequenceGaps: 1,
          lastSequence: 3,
          dashboardFramesSent: 1,
          dashboardFramesDropped: 1,
          instanceFramesSent: 1,
          instanceFramesDropped: 0,
          clientDecodedFrames: 0,
          clientDroppedFrames: 0,
          clientFps: 59.5,
          clientKeyframeRecoveries: 0,
          clientReconnects: 0,
          clientRenderedFrames: 2,
          clientSequenceGaps: 1,
        },
      ],
      aggregate: {
        clientDroppedFrames: 0,
        clientRenderedFrames: 2,
        clientSequenceGaps: 1,
        compressedBytes: 15,
        producedFrames: 2,
        rawBytes: 20,
        keyframesProduced: 1,
        deltaFrames: 1,
        sequenceGaps: 1,
        dashboardFramesSent: 1,
        dashboardFramesDropped: 1,
        instanceFramesSent: 1,
        instanceFramesDropped: 0,
      },
    });
  });
});

function createFrame(overrides: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    changedTiles: 0,
    frameType: StreamFrameType.Keyframe,
    height: 1,
    instanceIndex: 2,
    instanceId: "instance-a",
    payload: Buffer.from([1, 2, 3]),
    payloadBytes: 10,
    rawBytes: 10,
    sequence: 1,
    tileSize: 16,
    timestampMs: 123,
    token: "token-a",
    width: 1,
    ...overrides,
  };
}
