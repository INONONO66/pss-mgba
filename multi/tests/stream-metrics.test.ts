import { describe, expect, it } from "vitest";

import type { CapturedFrame } from "../src/streaming/FrameCapture.js";
import { StreamMetrics } from "../src/streaming/StreamMetrics.js";

describe("StreamMetrics", () => {
  it("records produced cadence and delivery drops per instance", () => {
    const metrics = new StreamMetrics();
    const first = createFrame({ timestampMs: 1000 });
    const second = createFrame({ sequence: 1, timestampMs: 2000 });

    metrics.recordProduced(first);
    metrics.recordProduced(second);
    metrics.recordDelivery(second, "dashboard", true);
    metrics.recordDelivery(second, "dashboard", false);
    metrics.recordDelivery(second, "instance", true);

    expect(metrics.snapshot(3000)).toEqual({
      generatedAtMs: 3000,
      instances: [
        {
          instanceId: "instance-a",
          instanceIndex: 2,
          producedFrames: 2,
          keyframesProduced: 2,
          sequenceGaps: 0,
          lastSequence: 1,
          firstProducedAtMs: 1000,
          lastProducedAtMs: 2000,
          producedFps: 1,
          dashboardFramesSent: 1,
          dashboardFramesDropped: 1,
          instanceFramesSent: 1,
          instanceFramesDropped: 0,
          clientRenderedFrames: 0,
          clientDecodedFrames: 0,
          clientDroppedFrames: 0,
          clientReconnects: 0,
          clientKeyframeRecoveries: 0,
          clientFps: undefined,
          clientBufferedFrames: undefined,
        },
      ],
      aggregate: {
        producedFrames: 2,
        keyframesProduced: 2,
        sequenceGaps: 0,
        dashboardFramesSent: 1,
        dashboardFramesDropped: 1,
        instanceFramesSent: 1,
        instanceFramesDropped: 0,
        clientRenderedFrames: 0,
        clientDecodedFrames: 0,
        clientDroppedFrames: 0,
        clientReconnects: 0,
        clientKeyframeRecoveries: 0,
      },
    });
  });

  it("records dashboard/client render metrics and sequence gaps", () => {
    const metrics = new StreamMetrics();
    metrics.recordProduced(createFrame({ sequence: 1, timestampMs: 1000 }));
    metrics.recordProduced(createFrame({ sequence: 4, timestampMs: 2000 }));
    metrics.recordClientMetrics({
      type: "client-metrics",
      instanceId: "instance-a",
      renderedFrames: 10,
      decodedFrames: 11,
      droppedFrames: 2,
      reconnects: 1,
      keyframeRecoveries: 1,
      fps: 59,
      bufferedFrames: 3,
    });

    expect(metrics.snapshot(3000).instances[0]).toMatchObject({
      sequenceGaps: 2,
      lastSequence: 4,
      clientRenderedFrames: 10,
      clientDecodedFrames: 11,
      clientDroppedFrames: 2,
      clientReconnects: 1,
      clientKeyframeRecoveries: 1,
      clientFps: 59,
      clientBufferedFrames: 3,
    });
  });
});

function createFrame(overrides: Partial<CapturedFrame> = {}): CapturedFrame {
  return {
    instanceIndex: 2,
    instanceId: "instance-a",
    isKeyframe: true,
    sequence: 0,
    token: "token-a",
    jpegBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    timestampMs: 123,
    ...overrides,
  };
}
