// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.

const STREAM_MAGIC = "PSMG";
const STREAM_VERSION = 1;
export const STREAM_HEADER_SIZE = 30;
export const VIEWER_CONTROL_MAX_BYTES = 4096;
const MAX_CLIENT_COUNTER = 10_000_000;
const MAX_CLIENT_FPS = 1000;

export const enum StreamFrameType {
  Keyframe = 1,
  Delta = 2,
  Meta = 3,
  ForceKeyframe = 4,
}

export const enum StreamFrameFlags {
  None = 0,
  DeflateRaw = 1 << 0,
}

interface StreamFrameEnvelope {
  frameType: StreamFrameType;
  flags: number;
  height: number;
  instanceIndex: number;
  payload: Buffer;
  payloadBytes: number;
  rawBytes: number;
  sequence: number;
  tileSize: number;
  timestampMs: number;
  version: number;
  width: number;
}

interface EncodableStreamFrame {
  frameType: StreamFrameType;
  flags?: number;
  height: number;
  instanceIndex: number;
  payload: Buffer;
  rawBytes: number;
  sequence: number;
  tileSize: number;
  timestampMs: number;
  width: number;
}

type ViewerControlMessage =
  | { type: "client-metrics"; metrics: ViewerClientMetrics }
  | { type: "keyframe" };

export interface ViewerClientMetrics {
  decodedFrames?: number;
  droppedFrames?: number;
  fps?: number;
  keyframeRecoveries?: number;
  reconnects?: number;
  renderedFrames?: number;
  sequenceGaps?: number;
}

export function encodeStreamFrame(frame: EncodableStreamFrame): Buffer {
  const header = Buffer.allocUnsafe(STREAM_HEADER_SIZE);
  header.write(STREAM_MAGIC, 0, "ascii");
  header.writeUInt8(STREAM_VERSION, 4);
  header.writeUInt8(frame.frameType, 5);
  header.writeUInt8(frame.instanceIndex % 256, 6);
  header.writeUInt8(frame.flags ?? StreamFrameFlags.None, 7);
  header.writeUInt32BE(frame.sequence >>> 0, 8);
  header.writeUInt32BE(frame.timestampMs >>> 0, 12);
  header.writeUInt16BE(frame.width, 16);
  header.writeUInt16BE(frame.height, 18);
  header.writeUInt16BE(frame.tileSize, 20);
  header.writeUInt32BE(frame.rawBytes >>> 0, 22);
  header.writeUInt32BE(frame.payload.byteLength >>> 0, 26);
  return Buffer.concat([header, frame.payload]);
}

export function decodeStreamFrame(data: Buffer): StreamFrameEnvelope | undefined {
  if (data.byteLength < STREAM_HEADER_SIZE) {
    return undefined;
  }
  if (data.toString("ascii", 0, 4) !== STREAM_MAGIC) {
    return undefined;
  }

  const payloadBytes = data.readUInt32BE(26);
  const expectedLength = STREAM_HEADER_SIZE + payloadBytes;
  if (data.byteLength !== expectedLength) {
    return undefined;
  }

  return {
    version: data.readUInt8(4),
    frameType: data.readUInt8(5) as StreamFrameType,
    instanceIndex: data.readUInt8(6),
    flags: data.readUInt8(7),
    sequence: data.readUInt32BE(8),
    timestampMs: data.readUInt32BE(12),
    width: data.readUInt16BE(16),
    height: data.readUInt16BE(18),
    tileSize: data.readUInt16BE(20),
    rawBytes: data.readUInt32BE(22),
    payloadBytes,
    payload: data.subarray(STREAM_HEADER_SIZE),
  };
}

export function parseViewerControlMessage(data: Buffer): ViewerControlMessage | undefined {
  if (data.byteLength > VIEWER_CONTROL_MAX_BYTES) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    return undefined;
  }

  const candidate = parsed as { type?: unknown; metrics?: unknown };
  if (candidate.type === "keyframe") {
    return { type: "keyframe" };
  }

  if (candidate.type !== "client-metrics") {
    return undefined;
  }

  return {
    type: "client-metrics",
    metrics: sanitizeClientMetrics(candidate.metrics),
  };
}

function sanitizeClientMetrics(value: unknown): ViewerClientMetrics {
  if (!value || typeof value !== "object") {
    return {};
  }

  const metrics = value as Record<string, unknown>;
  return {
    decodedFrames: optionalNonNegativeNumber(metrics.decodedFrames),
    droppedFrames: optionalNonNegativeNumber(metrics.droppedFrames),
    fps: optionalNonNegativeNumber(metrics.fps, MAX_CLIENT_FPS),
    keyframeRecoveries: optionalNonNegativeNumber(metrics.keyframeRecoveries),
    reconnects: optionalNonNegativeNumber(metrics.reconnects),
    renderedFrames: optionalNonNegativeNumber(metrics.renderedFrames),
    sequenceGaps: optionalNonNegativeNumber(metrics.sequenceGaps),
  };
}

function optionalNonNegativeNumber(value: unknown, maxValue = MAX_CLIENT_COUNTER): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.min(value, maxValue);
}
