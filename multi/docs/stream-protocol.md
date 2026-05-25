# Dashboard stream protocol

The dashboard WebSocket transport uses binary `pss-mgba-stream/v1` frames. It is intentionally not the old JPEG-image message path: the gateway decodes each emulator screenshot into RGBA pixels, sends compressed keyframes, and then sends compressed tile deltas.

## Endpoints

- `/ws/dashboard` subscribes to every instance stream and receives the latest cached keyframe for each instance immediately after connecting.
- `/ws/instance/:token` subscribes to one instance. Unknown tokens close with code `4001`.

Viewers may send JSON metric controls on either endpoint. Keyframe requests are honored only on `/ws/instance/:token`, which prevents anonymous dashboard-wide recovery storms:

```json
{ "type": "keyframe" }
```

```json
{
  "type": "client-metrics",
  "metrics": {
    "renderedFrames": 60,
    "decodedFrames": 60,
    "droppedFrames": 0,
    "sequenceGaps": 0,
    "keyframeRecoveries": 1,
    "reconnects": 0,
    "fps": 60
  }
}
```

Per-instance controls are constrained to the token's instance. Metrics are exposed through `/admin/metrics/streams` for benchmark collection.

## Binary envelope

All multi-byte integer fields are big-endian.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | ASCII magic `PSMG` |
| 4 | 1 | protocol version, currently `1` |
| 5 | 1 | frame type: `1` keyframe, `2` delta, `3` meta, `4` force-keyframe |
| 6 | 1 | instance index |
| 7 | 1 | flags; bit `0` means raw-deflate payload |
| 8 | 4 | per-instance sequence number |
| 12 | 4 | timestamp milliseconds modulo 2^32 |
| 16 | 2 | width |
| 18 | 2 | height |
| 20 | 2 | tile size |
| 22 | 4 | uncompressed raw RGBA byte count |
| 26 | 4 | payload byte count |
| 30 | N | payload |

## Payloads

Keyframe payloads are deflate-raw compressed RGBA pixels for the full frame.

Delta payloads are deflate-raw compressed tile records:

1. `u16` changed tile count.
2. For each changed tile: `u16 x`, `u16 y`, `u16 width`, `u16 height`, followed by `width * height * 4` RGBA bytes.

A delta with zero changed tiles is valid and still advances the sequence. Consumers count missing sequence numbers as stream drops.

## Benchmark implications

The headless benchmark decodes the envelope, not the payload, and uses message arrival cadence as the display-equivalent signal. It also folds client-observed sequence gaps and server-observed delivery drops into the dropped/late verdict so a stream cannot pass by silently skipping frames.
