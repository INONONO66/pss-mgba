import { describe, expect, it } from "vitest";

import {
  buildInstanceReport,
  finalizeBenchmarkReport,
  formatHumanSummary,
  summarize,
} from "../src/benchmark/report.js";

describe("headless benchmark report", () => {
  it("summarizes distributions with stable percentile fields", () => {
    expect(summarize([10, 20, 30, 40])).toEqual({
      count: 4,
      min: 10,
      max: 40,
      average: 25,
      p50: 20,
      p95: 40,
      p99: 40,
    });
  });

  it("marks an instance failed when p95 FPS or late-frame ratio misses the target", () => {
    const report = buildInstanceReport({
      instanceId: "slow-instance",
      receivedAtMs: [0, 20, 55, 90],
      durationMs: 90,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
    });

    expect(report.pass).toBe(false);
    expect(report.displayedFps.p95).toBeCloseTo(50);
    expect(report.droppedOrLateFrames).toBe(2);
    expect(report.failures).toContain("dropped/late ratio 0.40 > 0.01");
    expect(report.failures).toContain("sustained p95 FPS 28.57 < 60 (frame interval p95 35.00ms > 16.67ms)");
  });

  it("fails when upper-tail FPS hides sustained frame-interval misses", () => {
    const receivedAtMs = [0];
    for (let index = 0; index < 90; index += 1) {
      receivedAtMs.push((receivedAtMs.at(-1) ?? 0) + 1000 / 55);
    }
    for (let index = 0; index < 10; index += 1) {
      receivedAtMs.push((receivedAtMs.at(-1) ?? 0) + 10);
    }

    const report = buildInstanceReport({
      instanceId: "mostly-55fps",
      receivedAtMs,
      durationMs: receivedAtMs.at(-1) ?? 0,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
    });

    expect(report.displayedFps.p95).toBe(100);
    expect(report.pass).toBe(false);
    expect(report.failures).toContain(
      "sustained p95 FPS 55.00 < 60 (frame interval p95 18.18ms > 16.67ms)"
    );
  });

  it("counts leading and trailing silence as dropped or late frames", () => {
    const receivedAtMs: number[] = [];
    for (let timestamp = 30_000; timestamp < 60_000; timestamp += 1000 / 60) {
      receivedAtMs.push(timestamp);
    }

    const report = buildInstanceReport({
      instanceId: "half-silent",
      receivedAtMs,
      durationMs: 60_000,
      windowStartedAtMs: 0,
      windowEndedAtMs: 60_000,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
    });

    expect(report.expectedFrames).toBe(3600);
    expect(report.pass).toBe(false);
    expect(report.droppedOrLateFrameRatio).toBeGreaterThan(0.49);
  });

  it("counts long in-window stalls as frame-equivalent late frames even when delivery catches up", () => {
    const receivedAtMs: number[] = [];
    for (let timestamp = 0; timestamp < 10_000; timestamp += 1000 / 60) {
      receivedAtMs.push(timestamp);
    }
    for (let timestamp = 11_000; timestamp < 60_000; timestamp += 1000 / 60) {
      receivedAtMs.push(timestamp);
    }
    while (receivedAtMs.length < 3600) {
      receivedAtMs.push((receivedAtMs.at(-1) ?? 60_000) + 1);
    }

    const report = buildInstanceReport({
      instanceId: "caught-up-after-stall",
      receivedAtMs,
      durationMs: 60_000,
      windowStartedAtMs: 0,
      windowEndedAtMs: 60_000,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
    });

    expect(report.receivedFrames).toBe(3600);
    expect(report.pass).toBe(false);
    expect(report.droppedOrLateFrames).toBeGreaterThan(50);
    expect(report.failures).toContain(
      "dropped/late ratio 0.02 > 0.01"
    );
  });


  it("counts explicit stream sequence gaps as dropped frames", () => {
    const report = buildInstanceReport({
      instanceId: "gappy-stream",
      receivedAtMs: Array.from({ length: 60 }, (_value, frame) => frame * (1000 / 60)),
      durationMs: 1000,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
      sequenceGaps: 4,
    });

    expect(report.pass).toBe(false);
    expect(report.droppedOrLateFrames).toBe(4);
    expect(report.streamHealth.sequenceGaps).toBe(4);
  });

  it("prevents strict acceptance pass for reduced targets and incomplete RAM coverage", () => {
    const instance = buildInstanceReport({
      instanceId: "instance-a",
      receivedAtMs: [0, 16, 32, 48],
      durationMs: 48,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
    });

    const report = finalizeBenchmarkReport({
      generatedAt: new Date("2026-05-25T00:00:00Z"),
      baseUrl: "http://127.0.0.1:8787",
      target: {
        instances: 1,
        durationMs: 1000,
        minP95Fps: 30,
        maxDroppedOrLateRatio: 0.02,
        maxTotalRamBytes: 32 * 1024 * 1024 * 1024,
        strictAcceptance: true,
      },
      instances: [instance],
      resourceSamples: [
        {
          sampledAtMs: 1,
          totalMemoryBytes: 1024,
          containers: [{ id: "container-a", memoryBytes: 1024 }],
          processes: [],
        },
      ],
    });

    expect(report.verdict.pass).toBe(false);
    expect(report.resources.memoryCoverage).toBe("partial");
    expect(report.verdict.failures).toContain(
      "strict benchmark requires exactly 10 instances, got 1"
    );
    expect(report.verdict.failures).toContain(
      "strict benchmark requires duration >= 60000ms, got 1000ms"
    );
    expect(report.verdict.failures).toContain(
      "strict benchmark requires min p95 FPS >= 60, got 30"
    );
    expect(report.verdict.failures).toContain(
      "strict benchmark requires dropped/late ratio <= 0.01, got 0.02"
    );
    expect(report.verdict.failures).toContain(
      "strict benchmark requires RAM limit <= 17179869184 bytes, got 34359738368 bytes"
    );
    expect(report.verdict.failures).toContain(
      "strict benchmark requires benchmark-window stream metric delta"
    );
    expect(report.verdict.failures).toContain(
      "resource sample 0: gateway RSS unavailable"
    );
  });

  it("allows strict acceptance only with complete RAM and stream metric delta coverage", () => {
    const instances = Array.from({ length: 10 }, (_, index) =>
      buildInstanceReport({
        instanceId: `instance-${index}`,
        receivedAtMs: Array.from({ length: 3600 }, (_value, frame) =>
          frame * (1000 / 60)
        ),
        durationMs: 60_000,
        windowStartedAtMs: 0,
        windowEndedAtMs: 60_000,
        lateFrameThresholdMs: 25,
        minP95Fps: 60,
        maxDroppedOrLateRatio: 0.01,
      })
    );

    const report = finalizeBenchmarkReport({
      generatedAt: new Date("2026-05-25T00:00:00Z"),
      baseUrl: "http://127.0.0.1:8787",
      target: {
        instances: 10,
        durationMs: 60_000,
        minP95Fps: 60,
        maxDroppedOrLateRatio: 0.01,
        maxTotalRamBytes: 16 * 1024 * 1024 * 1024,
        strictAcceptance: true,
      },
      instances,
      resourceSamples: [
        {
          sampledAtMs: 1,
          totalMemoryBytes: 2048,
          containers: [{ id: "container-a", memoryBytes: 1024 }],
          processes: [{ pid: 1234, role: "gateway", rssBytes: 1024 }],
        },
      ],
      serverStreamMetrics: { delta: { instances: [] } },
    });

    expect(report.verdict.pass).toBe(true);
    expect(report.resources.memoryCoverage).toBe("complete");
  });

  it("fails RAM verdict when any selected resource sample is partial", () => {
    const report = finalizeBenchmarkReport({
      generatedAt: new Date("2026-05-25T00:00:00Z"),
      baseUrl: "http://127.0.0.1:8787",
      target: {
        instances: 0,
        durationMs: 60_000,
        minP95Fps: 60,
        maxDroppedOrLateRatio: 0.01,
        maxTotalRamBytes: 16 * 1024 * 1024 * 1024,
        requiresGatewayMemory: false,
        strictAcceptance: false,
      },
      instances: [],
      resourceSamples: [
        {
          sampledAtMs: 1,
          totalMemoryBytes: 1024,
          containers: [
            { id: "container-a", memoryBytes: 1024 },
            { id: "container-b", error: "docker unavailable" },
          ],
          processes: [],
        },
      ],
    });

    expect(report.verdict.pass).toBe(false);
    expect(report.resources.memoryCoverage).toBe("partial");
    expect(report.verdict.failures).toContain(
      "resource sample 0: container container-b docker unavailable"
    );
  });

  it("finalizes aggregate RAM verdict and human summary", () => {
    const instance = buildInstanceReport({
      instanceId: "instance-a",
      receivedAtMs: [0, 16, 32, 48],
      durationMs: 48,
      lateFrameThresholdMs: 25,
      minP95Fps: 60,
      maxDroppedOrLateRatio: 0.01,
    });
    const report = finalizeBenchmarkReport({
      generatedAt: new Date("2026-05-25T00:00:00Z"),
      baseUrl: "http://127.0.0.1:8787",
      target: {
        instances: 1,
        durationMs: 60_000,
        minP95Fps: 60,
        maxDroppedOrLateRatio: 0.01,
        maxTotalRamBytes: 16 * 1024 * 1024 * 1024,
        requiresGatewayMemory: false,
        strictAcceptance: false,
      },
      instances: [instance],
      resourceSamples: [
        {
          sampledAtMs: 1,
          totalMemoryBytes: 1024,
          containers: [{ id: "container-a", memoryBytes: 1024 }],
          processes: [],
        },
      ],
    });

    expect(report.verdict.pass).toBe(true);
    expect(report.resources.peakTotalMemoryBytes).toBe(1024);
    expect(formatHumanSummary(report)).toContain(
      "Headless mGBA benchmark: PASS"
    );
  });
});
