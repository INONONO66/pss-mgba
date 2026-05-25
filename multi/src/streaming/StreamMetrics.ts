// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import type { CapturedFrame } from "./FrameCapture.js";
import type { StreamClientMetricsMessage } from "./StreamProtocol.js";

export type StreamDeliveryTarget = "dashboard" | "instance";

export interface StreamInstanceMetricsSnapshot {
  clientBufferedFrames?: number;
  clientDecodedFrames: number;
  clientDroppedFrames: number;
  clientFps?: number;
  clientKeyframeRecoveries: number;
  clientReconnects: number;
  clientRenderedFrames: number;
  dashboardFramesDropped: number;
  dashboardFramesSent: number;
  firstProducedAtMs?: number;
  instanceFramesDropped: number;
  instanceFramesSent: number;
  instanceId: string;
  instanceIndex: number;
  keyframesProduced: number;
  lastProducedAtMs?: number;
  lastSequence?: number;
  producedFps: number;
  producedFrames: number;
  sequenceGaps: number;
}

export interface StreamMetricsSnapshot {
  aggregate: {
    clientDecodedFrames: number;
    clientDroppedFrames: number;
    clientKeyframeRecoveries: number;
    clientReconnects: number;
    clientRenderedFrames: number;
    dashboardFramesDropped: number;
    dashboardFramesSent: number;
    instanceFramesDropped: number;
    instanceFramesSent: number;
    keyframesProduced: number;
    producedFrames: number;
    sequenceGaps: number;
  };
  generatedAtMs: number;
  instances: StreamInstanceMetricsSnapshot[];
}

interface MutableStreamInstanceMetrics {
  clientBufferedFrames?: number;
  clientDecodedFrames: number;
  clientDroppedFrames: number;
  clientFps?: number;
  clientKeyframeRecoveries: number;
  clientReconnects: number;
  clientRenderedFrames: number;
  dashboardFramesDropped: number;
  dashboardFramesSent: number;
  firstProducedAtMs?: number;
  instanceFramesDropped: number;
  instanceFramesSent: number;
  instanceId: string;
  instanceIndex: number;
  keyframesProduced: number;
  lastProducedAtMs?: number;
  lastSequence?: number;
  producedFrames: number;
  sequenceGaps: number;
}

export class StreamMetrics {
  private readonly instances = new Map<string, MutableStreamInstanceMetrics>();

  recordProduced(frame: CapturedFrame): void {
    const metrics = this.getOrCreate(frame);
    metrics.instanceId = frame.instanceId;
    metrics.instanceIndex = frame.instanceIndex;
    if (
      metrics.lastSequence !== undefined &&
      frame.sequence > metrics.lastSequence + 1
    ) {
      metrics.sequenceGaps += frame.sequence - metrics.lastSequence - 1;
    }
    metrics.lastSequence = frame.sequence;
    metrics.producedFrames += 1;
    if (frame.isKeyframe) {
      metrics.keyframesProduced += 1;
    }
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

  recordClientMetrics(message: StreamClientMetricsMessage): void {
    const metrics = message.instanceId
      ? this.instances.get(message.instanceId) ??
        this.getOrCreateClientOnly(message.instanceId)
      : this.getOrCreateClientOnly(undefined);

    metrics.clientRenderedFrames += message.renderedFrames ?? 0;
    metrics.clientDecodedFrames += message.decodedFrames ?? 0;
    metrics.clientDroppedFrames += message.droppedFrames ?? 0;
    metrics.clientReconnects += message.reconnects ?? 0;
    metrics.clientKeyframeRecoveries += message.keyframeRecoveries ?? 0;
    metrics.clientFps = message.fps ?? metrics.clientFps;
    metrics.clientBufferedFrames =
      message.bufferedFrames ?? metrics.clientBufferedFrames;
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
          keyframesProduced:
            aggregate.keyframesProduced + metrics.keyframesProduced,
          sequenceGaps: aggregate.sequenceGaps + metrics.sequenceGaps,
          dashboardFramesSent:
            aggregate.dashboardFramesSent + metrics.dashboardFramesSent,
          dashboardFramesDropped:
            aggregate.dashboardFramesDropped + metrics.dashboardFramesDropped,
          instanceFramesSent:
            aggregate.instanceFramesSent + metrics.instanceFramesSent,
          instanceFramesDropped:
            aggregate.instanceFramesDropped + metrics.instanceFramesDropped,
          clientRenderedFrames:
            aggregate.clientRenderedFrames + metrics.clientRenderedFrames,
          clientDecodedFrames:
            aggregate.clientDecodedFrames + metrics.clientDecodedFrames,
          clientDroppedFrames:
            aggregate.clientDroppedFrames + metrics.clientDroppedFrames,
          clientReconnects: aggregate.clientReconnects + metrics.clientReconnects,
          clientKeyframeRecoveries:
            aggregate.clientKeyframeRecoveries + metrics.clientKeyframeRecoveries,
        }),
        {
          producedFrames: 0,
          keyframesProduced: 0,
          sequenceGaps: 0,
          dashboardFramesSent: 0,
          dashboardFramesDropped: 0,
          instanceFramesSent: 0,
          instanceFramesDropped: 0,
          clientRenderedFrames: 0,
          clientDecodedFrames: 0,
          clientDroppedFrames: 0,
          clientReconnects: 0,
          clientKeyframeRecoveries: 0,
        }
      ),
    };
  }

  private getOrCreate(frame: CapturedFrame): MutableStreamInstanceMetrics {
    const existing = this.instances.get(frame.instanceId);
    if (existing) {
      return existing;
    }

    const metrics = createEmptyMetrics(frame.instanceId, frame.instanceIndex);
    this.instances.set(frame.instanceId, metrics);
    return metrics;
  }

  private getOrCreateClientOnly(
    instanceId: string | undefined
  ): MutableStreamInstanceMetrics {
    const key = instanceId ?? "__dashboard__";
    const existing = this.instances.get(key);
    if (existing) {
      return existing;
    }

    const metrics = createEmptyMetrics(key, Number.MAX_SAFE_INTEGER);
    this.instances.set(key, metrics);
    return metrics;
  }
}

function createEmptyMetrics(
  instanceId: string,
  instanceIndex: number
): MutableStreamInstanceMetrics {
  return {
    instanceId,
    instanceIndex,
    producedFrames: 0,
    keyframesProduced: 0,
    sequenceGaps: 0,
    dashboardFramesSent: 0,
    dashboardFramesDropped: 0,
    instanceFramesSent: 0,
    instanceFramesDropped: 0,
    clientRenderedFrames: 0,
    clientDecodedFrames: 0,
    clientDroppedFrames: 0,
    clientReconnects: 0,
    clientKeyframeRecoveries: 0,
  };
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
    keyframesProduced: metrics.keyframesProduced,
    sequenceGaps: metrics.sequenceGaps,
    lastSequence: metrics.lastSequence,
    firstProducedAtMs: metrics.firstProducedAtMs,
    lastProducedAtMs: metrics.lastProducedAtMs,
    producedFps:
      elapsedMs > 0 ? (metrics.producedFrames - 1) / (elapsedMs / 1000) : 0,
    dashboardFramesSent: metrics.dashboardFramesSent,
    dashboardFramesDropped: metrics.dashboardFramesDropped,
    instanceFramesSent: metrics.instanceFramesSent,
    instanceFramesDropped: metrics.instanceFramesDropped,
    clientRenderedFrames: metrics.clientRenderedFrames,
    clientDecodedFrames: metrics.clientDecodedFrames,
    clientDroppedFrames: metrics.clientDroppedFrames,
    clientReconnects: metrics.clientReconnects,
    clientKeyframeRecoveries: metrics.clientKeyframeRecoveries,
    clientFps: metrics.clientFps,
    clientBufferedFrames: metrics.clientBufferedFrames,
  };
}
