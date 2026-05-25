# mGBA Multi-Instance Gateway

`multi/` hosts the Docker-managed mGBA gateway and dashboard stream fan-out used for local multi-instance runs. The PR 1 performance target is intentionally strict and measurable: 10 active instances for at least 60 seconds, every stream/display-equivalent p95 FPS at or above 60, dropped/late frames at or below 1%, and total gateway plus emulator RAM at or below 16 GiB.

## Headless performance benchmark

Start the gateway in one shell, then run the benchmark from this directory:

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

The command writes standalone machine-readable JSON and a human-readable summary. It exits non-zero when any pass/fail target is missed, so it can be used from CI or a server shell without opening the dashboard UI.

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
