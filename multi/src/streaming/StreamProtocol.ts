// biome-ignore-all lint/style/useFilenamingConvention: Existing multi modules use PascalCase filenames.

export const STREAM_PROTOCOL_MAGIC = 0x50_53_4d_47; // PSMG
export const STREAM_PROTOCOL_VERSION = 1;
export const STREAM_FRAME_HEADER_BYTES = 24;

export const STREAM_FRAME_KEYFRAME = 0x01;
export const STREAM_FRAME_DELTA = 0x02;
export const STREAM_FRAME_META = 0x03;
export const STREAM_FRAME_FORCE_KEYFRAME = 0x04;

export type StreamFrameType =
  | typeof STREAM_FRAME_KEYFRAME
  | typeof STREAM_FRAME_DELTA
  | typeof STREAM_FRAME_META
  | typeof STREAM_FRAME_FORCE_KEYFRAME;

export interface EncodedStreamFrameHeader {
  frameType: StreamFrameType;
  flags: number;
  instanceIndex: number;
  payloadBytes: number;
  sequence: number;
  timestampMs: number;
  version: number;
}

export interface DecodedStreamFrame {
  header: EncodedStreamFrameHeader;
  payload: Buffer;
}

export interface StreamClientMetricsMessage {
  bufferedFrames?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  fps?: number;
  instanceId?: string;
  keyframeRecoveries?: number;
  reconnects?: number;
  renderedFrames?: number;
  type: "client-metrics";
}

export type StreamClientControlMessage =
  | { type: "keyframe"; instanceId?: string }
  | StreamClientMetricsMessage;

export interface EncodeStreamFrameOptions {
  frameType?: StreamFrameType;
  flags?: number;
  instanceIndex: number;
  payload: Buffer;
  sequence: number;
  timestampMs: number;
}

export function encodeStreamFrame(opts: EncodeStreamFrameOptions): Buffer {
  const header = Buffer.allocUnsafe(STREAM_FRAME_HEADER_BYTES);
  header.writeUInt32BE(STREAM_PROTOCOL_MAGIC, 0);
  header.writeUInt8(STREAM_PROTOCOL_VERSION, 4);
  header.writeUInt8(opts.frameType ?? STREAM_FRAME_KEYFRAME, 5);
  header.writeUInt16BE(opts.instanceIndex % 65_536, 6);
  header.writeUInt32BE(normalizeUint32(opts.sequence), 8);
  header.writeUInt32BE(normalizeUint32(opts.timestampMs), 12);
  header.writeUInt32BE(opts.payload.byteLength, 16);
  header.writeUInt32BE(normalizeUint32(opts.flags ?? 0), 20);
  return Buffer.concat([header, opts.payload]);
}

export function decodeStreamFrame(data: Buffer): DecodedStreamFrame | undefined {
  if (data.byteLength < STREAM_FRAME_HEADER_BYTES) {
    return;
  }

  if (data.readUInt32BE(0) !== STREAM_PROTOCOL_MAGIC) {
    return;
  }

  const version = data.readUInt8(4);
  if (version !== STREAM_PROTOCOL_VERSION) {
    return;
  }

  const frameType = data.readUInt8(5) as StreamFrameType;
  if (!isStreamFrameType(frameType)) {
    return;
  }

  const payloadBytes = data.readUInt32BE(16);
  const payloadStart = STREAM_FRAME_HEADER_BYTES;
  const payloadEnd = payloadStart + payloadBytes;
  if (payloadEnd > data.byteLength) {
    return;
  }

  return {
    header: {
      version,
      frameType,
      instanceIndex: data.readUInt16BE(6),
      sequence: data.readUInt32BE(8),
      timestampMs: data.readUInt32BE(12),
      payloadBytes,
      flags: data.readUInt32BE(20),
    },
    payload: data.subarray(payloadStart, payloadEnd),
  };
}

export function parseStreamClientControl(
  text: string
): StreamClientControlMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    return;
  }

  const message = parsed as Record<string, unknown>;
  if (message.type === "keyframe") {
    return {
      type: "keyframe",
      instanceId: readOptionalString(message.instanceId),
    };
  }

  if (message.type !== "client-metrics") {
    return;
  }

  return {
    type: "client-metrics",
    instanceId: readOptionalString(message.instanceId),
    renderedFrames: readOptionalNonNegativeNumber(message.renderedFrames),
    decodedFrames: readOptionalNonNegativeNumber(message.decodedFrames),
    droppedFrames: readOptionalNonNegativeNumber(message.droppedFrames),
    fps: readOptionalNonNegativeNumber(message.fps),
    bufferedFrames: readOptionalNonNegativeNumber(message.bufferedFrames),
    reconnects: readOptionalNonNegativeNumber(message.reconnects),
    keyframeRecoveries: readOptionalNonNegativeNumber(
      message.keyframeRecoveries
    ),
  };
}

function isStreamFrameType(value: number): value is StreamFrameType {
  return (
    value === STREAM_FRAME_KEYFRAME ||
    value === STREAM_FRAME_DELTA ||
    value === STREAM_FRAME_META ||
    value === STREAM_FRAME_FORCE_KEYFRAME
  );
}

function normalizeUint32(value: number): number {
  return Math.trunc(value) >>> 0;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
