# Headless performance benchmark review notes

These notes capture the review checklist for the multi-instance benchmark work.
They are intentionally limited to the `multi/` gateway and benchmark surfaces;
they do not change gameplay logic, LLM policy, prompts, emulator memory behavior,
or mGBA core code.

## Acceptance target

A passing benchmark run must prove all of the following in a standalone report:

- 10 active emulator instances for at least 60 seconds.
- Every instance has display-equivalent p95 FPS >= 60.
- Every instance has dropped/late frame ratio <= 1%.
- Gateway plus emulator container/process RAM stays <= 16 GiB.
- Missing gateway RSS or partial container/process memory samples fail strict acceptance.
- JSON and human-readable summaries are emitted without opening the dashboard UI.

## Current baseline risks

The current gateway remains useful as a REST/WebSocket skeleton, but the inspected
baseline is not sufficient by itself as proof of the strict performance target:

- `src/streaming/FrameCapture.ts` uses a single timer that captures one instance
  per interval. With the default 100 ms interval and ten instances, that is about
  one capture per instance per second, not 60 fps per instance.
- `src/streaming/FrameCapture.ts` still uses the high-overhead
  screenshot-to-container-file-to-`docker exec cat`-to-`sharp` JPEG path. This is
  the path most likely to bottleneck the target and should not be the only
  measured transport for a pass verdict.
- The capture loop has no explicit in-flight guard. If capture/encode work takes
  longer than the timer interval, overlapping captures can race on the shared
  `/tmp/frame.png` capture path.
- `src/streaming/DashboardBroadcast.ts` frames include an instance index and
  timestamp, but no sequence number, frame type, reconnect counter, or recovery
  marker. That limits dropped-frame and stream-health accounting.
- The gateway root route still serves a placeholder dashboard, so live per-tile
  FPS/drop instrumentation is not yet visible through the gateway page.
- `src/instances/DockerDriver.ts` and `src/instances/InstanceManager.ts` provide
  lifecycle primitives, but the reviewed baseline does not yet expose sustained
  benchmark memory attribution or CPU sampling for gateway and emulator
  processes/containers.

## Report schema review checklist

Use this checklist for the JSON output before treating the benchmark as ready:

- `version` or schema identifier is present.
- `config` records requested instances, duration, target FPS, RAM limit, and late
  threshold.
- `measurementWindow.startedAt` and `measurementWindow.endedAt` use ISO timestamps.
- `instances[]` has exactly ten entries for a strict target run.
- Each instance includes FPS distribution, frame-interval distribution, expected
  frame count, produced frame count, rendered/display-equivalent frame count,
  dropped count, dropped/late ratio, measurement duration, and stream-health
  counters.
- Leading/trailing silence in the measurement window contributes to dropped/late
  ratio so the report cannot pass on a short burst of smooth frames.
- Server stream counters are reported as benchmark-window deltas, not gateway
  lifetime totals.
- Aggregate memory includes peak and average totals plus per-container/process
  samples; strict acceptance fails on partial memory coverage.
- `verdict` is deterministic and includes specific failure reasons.
- The human-readable summary is generated from the same data as the JSON report.

## Verification notes

Minimum local verification for documentation/review-only changes:

```bash
pnpm run typecheck
pnpm test
cd multi && pnpm run typecheck && pnpm test
```

When benchmark code changes are present, add focused tests for:

- percentile/distribution calculation, including empty and single-sample cases
- dropped/late frame ratio calculation at the documented threshold
- PASS/FAIL verdict boundaries for p95 FPS, late-frame ratio, leading/trailing silence, strict 10-instance/60-second floors, and 16 GiB RAM
- report serialization compatibility
- unavailable Docker/container metrics fallback behavior
- WebSocket backpressure/reconnect accounting
- versioned stream protocol parsing, sequence gaps, keyframe replay, and viewer metrics

Optional live verification requires Docker, the emulator image, and a legal ROM
path. Do not run live ROM/emulator checks in default tests.
