import { describe, expect, it } from "vitest";

import {
  decodeStreamFrame,
  encodeStreamFrame,
  parseViewerControlMessage,
  STREAM_HEADER_SIZE,
  StreamFrameFlags,
  StreamFrameType,
} from "../src/streaming/StreamProtocol.js";

describe("StreamProtocol", () => {
  it("round-trips a compressed keyframe envelope", () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const encoded = encodeStreamFrame({
      frameType: StreamFrameType.Keyframe,
      flags: StreamFrameFlags.DeflateRaw,
      height: 160,
      instanceIndex: 7,
      payload,
      rawBytes: 240 * 160 * 4,
      sequence: 42,
      tileSize: 16,
      timestampMs: 0x12_34_56_78,
      width: 240,
    });

    expect(encoded.subarray(0, 4).toString("ascii")).toBe("PSMG");
    expect(encoded.byteLength).toBe(STREAM_HEADER_SIZE + payload.byteLength);
    expect(decodeStreamFrame(encoded)).toMatchObject({
      frameType: StreamFrameType.Keyframe,
      flags: StreamFrameFlags.DeflateRaw,
      height: 160,
      instanceIndex: 7,
      payloadBytes: 4,
      rawBytes: 153_600,
      sequence: 42,
      tileSize: 16,
      timestampMs: 0x12_34_56_78,
      width: 240,
    });
    expect(decodeStreamFrame(encoded)?.payload).toEqual(payload);
  });

  it("rejects malformed binary frames", () => {
    expect(decodeStreamFrame(Buffer.alloc(0))).toBeUndefined();
    expect(decodeStreamFrame(Buffer.from("JPEG-ish"))).toBeUndefined();
    const encoded = encodeStreamFrame({
      frameType: StreamFrameType.Delta,
      height: 1,
      instanceIndex: 0,
      payload: Buffer.from([1, 2]),
      rawBytes: 4,
      sequence: 1,
      tileSize: 16,
      timestampMs: 1,
      width: 1,
    });
    expect(decodeStreamFrame(encoded.subarray(0, -1))).toBeUndefined();
  });

  it("parses viewer controls without trusting arbitrary fields", () => {
    expect(parseViewerControlMessage(Buffer.from('{"type":"keyframe"}'))).toEqual({ type: "keyframe" });
    expect(
      parseViewerControlMessage(
        Buffer.from(JSON.stringify({
          type: "client-metrics",
          metrics: { renderedFrames: 20_000_000, sequenceGaps: 2, fps: 5000, ignored: true },
        }))
      )
    ).toMatchObject({
      type: "client-metrics",
      metrics: { renderedFrames: 10_000_000, sequenceGaps: 2, fps: 1000 },
    });
    expect(parseViewerControlMessage(Buffer.alloc(4097, "{"))).toBeUndefined();
  });
});
