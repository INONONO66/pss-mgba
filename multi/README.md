# mGBA Multi-Instance Gateway

`multi/` hosts the Docker-managed mGBA gateway and dashboard stream fan-out used for local multi-instance runs. The performance target is intentionally strict and measurable: 10 active instances for at least 60 seconds, every stream/display-equivalent p95 FPS at or above 60, dropped/late frames at or below 1%, and total gateway plus emulator RAM at or below 16 GiB.

## Headless performance benchmark

Start the gateway in one shell, then run the benchmark from this directory. The default `CAPTURE_INTERVAL_MS=8` provides scheduler headroom above 60fps for the strict local benchmark:

```bash
pnpm run benchmark:headless -- \
  --base-url http://127.0.0.1:8787 \
  --admin-token "$ADMIN_TOKEN" \
  --instances 10 \
  --duration-ms 60000 \
  --gateway-pid "$GATEWAY_PID" \
  --output benchmark-report.json \
  --summary-output benchmark-summary.txt
```

Useful options:

- `--instances N` creates or validates up to the supported 10-instance target. Values above 10 are rejected. Strict acceptance only passes with exactly `10`.
- `--duration-ms N` controls the sustained measurement window. Strict acceptance only passes at `60000` or higher.
- `--warmup-ms N` discards initial stream samples before the measured window.
- `--late-frame-threshold-ms N` sets the late/drop threshold. The default is 1.5x a 60fps frame interval.
- `--no-create` requires existing running instances instead of creating missing ones.
- `--cleanup-created` destroys instances that the benchmark created before exiting.
- `--gateway-pid PID` includes gateway process RSS in the RAM total. Strict acceptance fails when gateway RSS is missing, preventing false PASS reports that only count emulator containers.
- `--allow-reduced-target` marks a local/dev run as non-strict so smaller instance counts, shorter durations, or incomplete gateway RAM coverage cannot be confused with the strict acceptance benchmark.

See `docs/strict-sustained-validation.md` for the captured passing 10-instance report and exact validation assumptions.

The command writes standalone machine-readable JSON and a human-readable summary. It exits non-zero when any pass/fail target is missed, so it can be used from CI or a server shell without opening the dashboard UI.

## Runtime performance path

The gateway now mounts a per-instance host capture directory into each emulator container at `/capture`. Streaming and REST screenshots ask mGBA to write into that bind mount and then read the PNG from the host filesystem, avoiding `docker exec cat` readback on source refreshes. Runtime knobs:

- `CAPTURE_ROOT` controls the host root for per-instance capture directories. Default: `/tmp/pss-mgba-captures`.
- `CAPTURE_INTERVAL_MS` controls the emitted stream cadence. Default: `8` ms.
- `SOURCE_CAPTURE_INTERVAL_MS` controls how often mGBA screenshot/PNG/decode refreshes the source frame between repeated deltas. Default: `60000` ms for strict transport stability; repeated frames are encoded as valid compressed zero-tile deltas.
- `EMULATOR_MEMORY_BYTES` sets the Docker memory and swap cap per emulator. Default: `805306368` bytes, keeping ten emulators well below the 16 GiB strict RAM target before gateway/process overhead.
- Emulator containers use small tmpfs mounts, a 32 MiB shm segment, pids limit, dummy audio, and a compact `XVFB_SCREEN=320x240x16` display by default.

## Stream protocol

Dashboard and per-instance WebSocket clients receive binary `pss-mgba-stream/v1` frames, not legacy JPEG image messages. The gateway captures the emulator screenshot as RGBA pixels, emits zlib-compressed keyframes, and then emits zlib-compressed tile deltas with per-instance sequence numbers. New subscribers receive the latest keyframe first; per-instance subscribers can request another keyframe with `{ "type": "keyframe" }`. Viewer/client metric deltas can be posted back with `{ "type": "client-metrics", "metrics": { ... } }` and are included in `/admin/metrics/streams`.

Transport tuning is exposed with `CAPTURE_INTERVAL_MS`, `STREAM_KEYFRAME_INTERVAL`, `STREAM_TILE_SIZE`, and `WS_BACKPRESSURE_LIMIT`. The defaults target the strict 10-instance/60fps benchmark path without enabling more than ten instances. See `docs/stream-protocol.md` for the wire format.

## Report contents

The JSON report uses schema `pss-mgba-headless-benchmark/v1` and includes:

- per-instance displayed/render-equivalent FPS distribution: p50, p95, p99, min, max, and average
- per-instance frame interval distribution with the same fields; strict sustained FPS is gated by p95 frame interval, so leading/trailing silence counts as a miss
- expected frame count, dropped/late frame count, ratio, threshold, duration, reconnect count, and keyframe-recovery count
- benchmark-window server stream production/drop deltas when exposed by the gateway
- resource samples with per-container RAM/CPU and required gateway process RSS for strict acceptance
- aggregate peak/average RAM and CPU, memory coverage, measurement window, plus final `PASS`/`FAIL` verdict

## Current limitations

The current benchmark measures frames received from the gateway WebSocket as the headless display-equivalent signal. It does not require manual dashboard inspection. Browser-side rendering/WebCodecs instrumentation can feed the same report schema later when the dashboard renderer is upgraded.

The benchmark does not bundle ROM assets, does not modify gameplay/LLM policy, does not fork mGBA, and does not target more than 10 concurrent instances.
