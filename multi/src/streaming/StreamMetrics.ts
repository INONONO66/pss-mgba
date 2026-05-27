// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.
import type { CapturedFrame } from "./FrameCapture.js";
import { StreamFrameType, type ViewerClientMetrics } from "./StreamProtocol.js";

type StreamDeliveryTarget = "dashboard" | "instance";

interface StreamInstanceMetricsSnapshot {
  clientDecodedFrames: number;
  clientDroppedFrames: number;
  clientFps?: number;
  clientKeyframeRecoveries: number;
  clientReconnects: number;
  clientRenderedFrames: number;
  clientSequenceGaps: number;
  compressedBytes: number;
  compressionRatio: number;
  dashboardFramesDropped: number;
  dashboardFramesSent: number;
  deltaFrames: number;
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
  rawBytes: number;
  sequenceGaps: number;
}

interface StreamMetricsSnapshot {
  aggregate: {
    clientDroppedFrames: number;
    clientRenderedFrames: number;
    clientSequenceGaps: number;
    compressedBytes: number;
    dashboardFramesDropped: number;
    dashboardFramesSent: number;
    deltaFrames: number;
    instanceFramesDropped: number;
    instanceFramesSent: number;
    keyframesProduced: number;
    producedFrames: number;
    rawBytes: number;
    sequenceGaps: number;
  };
  generatedAtMs: number;
  instances: StreamInstanceMetricsSnapshot[];
}

interface MutableStreamInstanceMetrics {
  clientDecodedFrames: number;
  clientDroppedFrames: number;
  clientFps?: number;
  clientKeyframeRecoveries: number;
  clientReconnects: number;
  clientRenderedFrames: number;
  clientSequenceGaps: number;
  compressedBytes: number;
  dashboardFramesDropped: number;
  dashboardFramesSent: number;
  deltaFrames: number;
  firstProducedAtMs?: number;
  instanceFramesDropped: number;
  instanceFramesSent: number;
  instanceId: string;
  instanceIndex: number;
  keyframesProduced: number;
  lastProducedAtMs?: number;
  lastSequence?: number;
  producedFrames: number;
  rawBytes: number;
  sequenceGaps: number;
}

export class StreamMetrics {
  private readonly instances = new Map<string, MutableStreamInstanceMetrics>();
  private readonly anonymousClientMetrics: MutableStreamInstanceMetrics = createMutableMetrics("dashboard", -1);

  recordProduced(frame: CapturedFrame): void {
    const metrics = this.getOrCreate(frame);
    metrics.instanceId = frame.instanceId;
    metrics.instanceIndex = frame.instanceIndex;
    metrics.producedFrames += 1;
    metrics.rawBytes += frame.rawBytes;
    metrics.compressedBytes += frame.payloadBytes;
    if (frame.frameType === StreamFrameType.Keyframe) {
      metrics.keyframesProduced += 1;
    } else if (frame.frameType === StreamFrameType.Delta) {
      metrics.deltaFrames += 1;
    }
    if (metrics.lastSequence !== undefined && frame.sequence > metrics.lastSequence + 1) {
      metrics.sequenceGaps += frame.sequence - metrics.lastSequence - 1;
    }
    metrics.lastSequence = frame.sequence;
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

  recordClientMetrics(instanceId: string | undefined, client: ViewerClientMetrics): void {
    const metrics = instanceId === undefined
      ? this.anonymousClientMetrics
      : this.getOrCreateById(instanceId, 0);
    metrics.clientDecodedFrames += client.decodedFrames ?? 0;
    metrics.clientDroppedFrames += client.droppedFrames ?? 0;
    metrics.clientKeyframeRecoveries += client.keyframeRecoveries ?? 0;
    metrics.clientReconnects += client.reconnects ?? 0;
    metrics.clientRenderedFrames += client.renderedFrames ?? 0;
    metrics.clientSequenceGaps += client.sequenceGaps ?? 0;
    metrics.clientFps = client.fps ?? metrics.clientFps;
  }

  snapshot(nowMs = Date.now()): StreamMetricsSnapshot {
    const instances = Array.from(this.instances.values())
      .map((metrics) => snapshotInstance(metrics))
      .sort(
        (a, b) =>
          a.instanceIndex - b.instanceIndex ||
          a.instanceId.localeCompare(b.instanceId)
      );

    const initialAggregate = {
      clientDroppedFrames: this.anonymousClientMetrics.clientDroppedFrames,
      clientRenderedFrames: this.anonymousClientMetrics.clientRenderedFrames,
      clientSequenceGaps: this.anonymousClientMetrics.clientSequenceGaps,
      compressedBytes: 0,
      producedFrames: 0,
      rawBytes: 0,
      keyframesProduced: 0,
      deltaFrames: 0,
      sequenceGaps: 0,
      dashboardFramesSent: 0,
      dashboardFramesDropped: 0,
      instanceFramesSent: 0,
      instanceFramesDropped: 0,
    };

    return {
      generatedAtMs: nowMs,
      instances,
      aggregate: instances.reduce(
        (aggregate, metrics) => ({
          clientDroppedFrames: aggregate.clientDroppedFrames + metrics.clientDroppedFrames,
          clientRenderedFrames: aggregate.clientRenderedFrames + metrics.clientRenderedFrames,
          clientSequenceGaps: aggregate.clientSequenceGaps + metrics.clientSequenceGaps,
          compressedBytes: aggregate.compressedBytes + metrics.compressedBytes,
          producedFrames: aggregate.producedFrames + metrics.producedFrames,
          rawBytes: aggregate.rawBytes + metrics.rawBytes,
          keyframesProduced: aggregate.keyframesProduced + metrics.keyframesProduced,
          deltaFrames: aggregate.deltaFrames + metrics.deltaFrames,
          sequenceGaps: aggregate.sequenceGaps + metrics.sequenceGaps,
          dashboardFramesSent:
            aggregate.dashboardFramesSent + metrics.dashboardFramesSent,
          dashboardFramesDropped:
            aggregate.dashboardFramesDropped + metrics.dashboardFramesDropped,
          instanceFramesSent:
            aggregate.instanceFramesSent + metrics.instanceFramesSent,
          instanceFramesDropped:
            aggregate.instanceFramesDropped + metrics.instanceFramesDropped,
        }),
        initialAggregate
      ),
    };
  }

  private getOrCreate(frame: CapturedFrame): MutableStreamInstanceMetrics {
    return this.getOrCreateById(frame.instanceId, frame.instanceIndex);
  }

  private getOrCreateById(instanceId: string, instanceIndex: number): MutableStreamInstanceMetrics {
    const existing = this.instances.get(instanceId);
    if (existing) {
      return existing;
    }

    const metrics = createMutableMetrics(instanceId, instanceIndex);
    this.instances.set(instanceId, metrics);
    return metrics;
  }
}

function createMutableMetrics(instanceId: string, instanceIndex: number): MutableStreamInstanceMetrics {
  return {
    clientDecodedFrames: 0,
    clientDroppedFrames: 0,
    clientKeyframeRecoveries: 0,
    clientReconnects: 0,
    clientRenderedFrames: 0,
    clientSequenceGaps: 0,
    compressedBytes: 0,
    instanceId,
    instanceIndex,
    producedFrames: 0,
    rawBytes: 0,
    keyframesProduced: 0,
    deltaFrames: 0,
    sequenceGaps: 0,
    dashboardFramesSent: 0,
    dashboardFramesDropped: 0,
    instanceFramesSent: 0,
    instanceFramesDropped: 0,
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
    firstProducedAtMs: metrics.firstProducedAtMs,
    lastProducedAtMs: metrics.lastProducedAtMs,
    producedFps:
      elapsedMs > 0 ? (metrics.producedFrames - 1) / (elapsedMs / 1000) : 0,
    rawBytes: metrics.rawBytes,
    compressedBytes: metrics.compressedBytes,
    compressionRatio: metrics.rawBytes > 0 ? metrics.compressedBytes / metrics.rawBytes : 0,
    keyframesProduced: metrics.keyframesProduced,
    deltaFrames: metrics.deltaFrames,
    sequenceGaps: metrics.sequenceGaps,
    lastSequence: metrics.lastSequence,
    dashboardFramesSent: metrics.dashboardFramesSent,
    dashboardFramesDropped: metrics.dashboardFramesDropped,
    instanceFramesSent: metrics.instanceFramesSent,
    instanceFramesDropped: metrics.instanceFramesDropped,
    clientDecodedFrames: metrics.clientDecodedFrames,
    clientDroppedFrames: metrics.clientDroppedFrames,
    clientFps: metrics.clientFps,
    clientKeyframeRecoveries: metrics.clientKeyframeRecoveries,
    clientReconnects: metrics.clientReconnects,
    clientRenderedFrames: metrics.clientRenderedFrames,
    clientSequenceGaps: metrics.clientSequenceGaps,
  };
}
