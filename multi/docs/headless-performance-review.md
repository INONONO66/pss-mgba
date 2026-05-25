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

## Baseline risks tracked by the benchmark

The benchmark infrastructure is strict, but these runtime risks remain relevant
when deciding whether a live run proves the 10-instance target:

- `src/streaming/FrameCapture.ts` schedules every registered instance each
  interval with per-instance in-flight guards. The default
  `CAPTURE_INTERVAL_MS=8` is intended to keep local timer jitter below the
  60fps frame budget, but it must still be validated under load before a
  strict pass is accepted.
- The gateway still obtains source pixels through mGBA screenshot, but the runtime capture path
  removes the Docker CLI readback by mounting a per-instance
  host capture directory at `/capture` and reading the file directly from the
  gateway process.
- `src/streaming/DashboardBroadcast.ts` now sends typed keyframe/delta frames
  with sequence numbers, keyframe replay, and client metric ingestion. The
  benchmark must continue treating sequence gaps and server/client drop counters
  as dropped-frame evidence.
- The gateway root route still serves a placeholder dashboard, so live per-tile
  FPS/drop instrumentation is not yet visible through the gateway page.
- `src/instances/DockerDriver.ts` caps per-emulator memory/swap, pids, tmpfs,
  and shm while keeping the 10-instance cap. Live benchmark memory attribution
  still comes from the strict headless benchmark resource samples.

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

Optional live verification requires Docker, the emulator image, and a legal ROM
path. Do not run live ROM/emulator checks in default tests.
