import { describe, expect, it } from "vitest";

import {
  decodeStreamFrame,
  encodeStreamFrame,
  parseStreamClientControl,
  STREAM_FRAME_DELTA,
  STREAM_FRAME_KEYFRAME,
} from "../src/streaming/StreamProtocol.js";

describe("StreamProtocol", () => {
  it("roundtrips a versioned binary frame header and payload", () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const encoded = encodeStreamFrame({
      frameType: STREAM_FRAME_DELTA,
      flags: 3,
      instanceIndex: 9,
      payload,
      sequence: 123,
      timestampMs: 456,
    });

    expect(decodeStreamFrame(encoded)).toEqual({
      header: {
        version: 1,
        frameType: STREAM_FRAME_DELTA,
        instanceIndex: 9,
        sequence: 123,
        timestampMs: 456,
        payloadBytes: payload.byteLength,
        flags: 3,
      },
      payload,
    });
  });

  it("rejects malformed binary frames", () => {
    expect(decodeStreamFrame(Buffer.alloc(2))).toBeUndefined();
    expect(decodeStreamFrame(Buffer.from("not-a-stream-frame"))).toBeUndefined();

    const versionMismatch = encodeStreamFrame({
      instanceIndex: 1,
      payload: Buffer.from([1]),
      sequence: 1,
      timestampMs: 1,
    });
    versionMismatch.writeUInt8(2, 4);
    expect(decodeStreamFrame(versionMismatch)).toBeUndefined();
  });

  it("parses viewer keyframe requests and render metrics", () => {
    expect(parseStreamClientControl('{"type":"keyframe","instanceId":"a"}')).toEqual({
      type: "keyframe",
      instanceId: "a",
    });
    expect(
      parseStreamClientControl(
        JSON.stringify({
          type: "client-metrics",
          instanceId: "a",
          renderedFrames: 60,
          decodedFrames: 61,
          droppedFrames: 1,
          fps: 59.5,
          bufferedFrames: 2,
          reconnects: 1,
          keyframeRecoveries: 1,
        })
      )
    ).toEqual({
      type: "client-metrics",
      instanceId: "a",
      renderedFrames: 60,
      decodedFrames: 61,
      droppedFrames: 1,
      fps: 59.5,
      bufferedFrames: 2,
      reconnects: 1,
      keyframeRecoveries: 1,
    });
  });

  it("defaults encoded frame type to keyframe", () => {
    const encoded = encodeStreamFrame({
      instanceIndex: 1,
      payload: Buffer.from([1]),
      sequence: 1,
      timestampMs: 1,
    });

    expect(decodeStreamFrame(encoded)?.header.frameType).toBe(
      STREAM_FRAME_KEYFRAME
    );
  });
});
