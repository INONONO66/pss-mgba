// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import type { CapturedFrame } from "./FrameCapture.js";

export type StreamDeliveryTarget = "dashboard" | "instance";

export interface StreamInstanceMetricsSnapshot {
  dashboardFramesDropped: number;
  dashboardFramesSent: number;
  firstProducedAtMs?: number;
  instanceFramesDropped: number;
  instanceFramesSent: number;
  instanceId: string;
  instanceIndex: number;
  lastProducedAtMs?: number;
  producedFps: number;
  producedFrames: number;
}

export interface StreamMetricsSnapshot {
  aggregate: {
    producedFrames: number;
    dashboardFramesSent: number;
    dashboardFramesDropped: number;
    instanceFramesSent: number;
    instanceFramesDropped: number;
  };
  generatedAtMs: number;
  instances: StreamInstanceMetricsSnapshot[];
}

interface MutableStreamInstanceMetrics {
  dashboardFramesDropped: number;
  dashboardFramesSent: number;
  firstProducedAtMs?: number;
  instanceFramesDropped: number;
  instanceFramesSent: number;
  instanceId: string;
  instanceIndex: number;
  lastProducedAtMs?: number;
  producedFrames: number;
}

export class StreamMetrics {
  private readonly instances = new Map<string, MutableStreamInstanceMetrics>();

  recordProduced(frame: CapturedFrame): void {
    const metrics = this.getOrCreate(frame);
    metrics.instanceId = frame.instanceId;
    metrics.instanceIndex = frame.instanceIndex;
    metrics.producedFrames += 1;
    metrics.firstProducedAtMs ??= frame.timestampMs;
    metrics.lastProducedAtMs = frame.timestampMs;
  }

  recordDelivery(
    frame: CapturedFrame,
    target: StreamDeliveryTarget,
    delivered: boolean
  ): void {
    const metrics = this.getOrCreate(frame);
    if (target === "dashboard") {
      if (delivered) {
        metrics.dashboardFramesSent += 1;
      } else {
        metrics.dashboardFramesDropped += 1;
      }
      return;
    }

    if (delivered) {
      metrics.instanceFramesSent += 1;
    } else {
      metrics.instanceFramesDropped += 1;
    }
  }

  snapshot(nowMs = Date.now()): StreamMetricsSnapshot {
    const instances = Array.from(this.instances.values())
      .map((metrics) => snapshotInstance(metrics))
      .sort(
        (a, b) =>
          a.instanceIndex - b.instanceIndex ||
          a.instanceId.localeCompare(b.instanceId)
      );

    return {
      generatedAtMs: nowMs,
      instances,
      aggregate: instances.reduce(
        (aggregate, metrics) => ({
          producedFrames: aggregate.producedFrames + metrics.producedFrames,
          dashboardFramesSent:
            aggregate.dashboardFramesSent + metrics.dashboardFramesSent,
          dashboardFramesDropped:
            aggregate.dashboardFramesDropped + metrics.dashboardFramesDropped,
          instanceFramesSent:
            aggregate.instanceFramesSent + metrics.instanceFramesSent,
          instanceFramesDropped:
            aggregate.instanceFramesDropped + metrics.instanceFramesDropped,
        }),
        {
          producedFrames: 0,
          dashboardFramesSent: 0,
          dashboardFramesDropped: 0,
          instanceFramesSent: 0,
          instanceFramesDropped: 0,
        }
      ),
    };
  }

  private getOrCreate(frame: CapturedFrame): MutableStreamInstanceMetrics {
    const existing = this.instances.get(frame.instanceId);
    if (existing) {
      return existing;
    }

    const metrics: MutableStreamInstanceMetrics = {
      instanceId: frame.instanceId,
      instanceIndex: frame.instanceIndex,
      producedFrames: 0,
      dashboardFramesSent: 0,
      dashboardFramesDropped: 0,
      instanceFramesSent: 0,
      instanceFramesDropped: 0,
    };
    this.instances.set(frame.instanceId, metrics);
    return metrics;
  }
}

function snapshotInstance(
  metrics: MutableStreamInstanceMetrics
): StreamInstanceMetricsSnapshot {
  const elapsedMs =
    metrics.firstProducedAtMs === undefined ||
    metrics.lastProducedAtMs === undefined
      ? 0
      : Math.max(0, metrics.lastProducedAtMs - metrics.firstProducedAtMs);

  return {
    instanceId: metrics.instanceId,
    instanceIndex: metrics.instanceIndex,
    producedFrames: metrics.producedFrames,
    firstProducedAtMs: metrics.firstProducedAtMs,
    lastProducedAtMs: metrics.lastProducedAtMs,
    producedFps:
      elapsedMs > 0 ? (metrics.producedFrames - 1) / (elapsedMs / 1000) : 0,
    dashboardFramesSent: metrics.dashboardFramesSent,
    dashboardFramesDropped: metrics.dashboardFramesDropped,
    instanceFramesSent: metrics.instanceFramesSent,
    instanceFramesDropped: metrics.instanceFramesDropped,
  };
}
