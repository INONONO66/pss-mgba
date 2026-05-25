import { describe, expect, it } from "vitest";

import type { CapturedFrame } from "../src/streaming/FrameCapture.js";
import { StreamMetrics } from "../src/streaming/StreamMetrics.js";

describe("StreamMetrics", () => {
  it("records produced cadence and delivery drops per instance", () => {
    const metrics = new StreamMetrics();
    const first = createFrame({ timestampMs: 1000 });
    const second = createFrame({ timestampMs: 2000 });

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
          firstProducedAtMs: 1000,
          lastProducedAtMs: 2000,
          producedFps: 1,
          dashboardFramesSent: 1,
          dashboardFramesDropped: 1,
          instanceFramesSent: 1,
          instanceFramesDropped: 0,
        },
      ],
      aggregate: {
        producedFrames: 2,
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
    instanceIndex: 2,
    instanceId: "instance-a",
    token: "token-a",
    jpegBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    timestampMs: 123,
    ...overrides,
  };
}
