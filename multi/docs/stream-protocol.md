# Dashboard stream protocol

The gateway WebSocket stream now uses a versioned binary envelope instead of the
legacy five-byte dashboard header. The payload can still be a JPEG screenshot for
this PR, but the envelope is ready for higher-throughput transports such as VP8
or another delta/keyframe codec in the runtime PRs.

## Binary frame layout

Each `/ws/dashboard` and `/ws/instance/:token` binary message is:

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 4 | magic `PSMG` |
| 4 | 1 | protocol version, currently `1` |
| 5 | 1 | frame type: `1` keyframe, `2` delta, `3` metadata, `4` force-keyframe |
| 6 | 2 | instance index, big-endian |
| 8 | 4 | per-instance sequence number, big-endian |
| 12 | 4 | capture timestamp in milliseconds, big-endian |
| 16 | 4 | payload byte length, big-endian |
| 20 | 4 | flags, big-endian |
| 24 | N | encoded payload |

The current screenshot capture path emits JPEG keyframes. Consumers must not
assume that future frames are JPEGs; the protocol type and keyframe/delta fields
are the compatibility boundary for later codec work.

## Viewer control messages

Clients may send JSON text messages over the same WebSocket:

- `{ "type": "keyframe", "instanceId": "..." }` asks the gateway to replay the
  latest keyframe for an instance. Dashboard-wide sockets can omit `instanceId`
  to replay all latest keyframes.
- `{ "type": "client-metrics", ... }` reports viewer-side decode/render health.
  Supported counters are `renderedFrames`, `decodedFrames`, `droppedFrames`,
  `fps`, `bufferedFrames`, `reconnects`, and `keyframeRecoveries`.

The admin `/admin/metrics/streams` endpoint includes server-side sequence gaps,
keyframe counts, delivery drops, and aggregated client metrics. The strict
headless benchmark treats protocol sequence gaps as dropped frames, so a smooth
arrival cadence cannot hide missing frames.
