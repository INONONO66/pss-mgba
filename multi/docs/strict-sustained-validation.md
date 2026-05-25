# Strict sustained 10-instance validation

This repository keeps the strict acceptance target measurable without opening the dashboard UI:

- exactly 10 running emulator instances
- sustained measurement window of at least 60 seconds
- every instance has p95 frame interval at or below the 60fps frame budget
- dropped/late frame ratio at or below 1%
- gateway plus emulator RAM at or below 16 GiB with complete gateway RSS coverage
- benchmark-window stream metric deltas present in the report

## Local strict run

A local strict run was executed with Docker Desktop, the `pss-mgba-emulator:latest` image built from `multi/docker/emulator`, and a locally supplied legal ROM. This validation measures transport/display cadence at the WebSocket boundary, not fresh emulator screenshot cadence. The strict benchmark command used the default max-10 instance cap and the runtime transport defaults that keep delivery cadence above the 60fps acceptance floor:

```bash
(
cd multi
ADMIN_TOKEN=dev-admin-token \
ROM_PATH=/path/to/legal-rom.gb \
CAPTURE_ROOT=/tmp/pss-mgba-captures \
EMULATOR_IMAGE=pss-mgba-emulator:latest \
exec ./node_modules/.bin/tsx src/index.ts
) &
GATEWAY_PID=$!

cd ..
pnpm --dir multi benchmark:headless -- \
  --base-url http://127.0.0.1:8787 \
  --admin-token dev-admin-token \
  --instances 10 \
  --duration-ms 60000 \
  --gateway-pid "$GATEWAY_PID" \
  --output benchmark-report.json \
  --summary-output benchmark-summary.txt \
  --cleanup-created
```

Captured outputs are checked in under `multi/docs/benchmarks/2026-05-26-strict-local/`:

- `benchmark-report.json` — machine-readable strict report
- `benchmark-summary.txt` — human-readable summary generated from the same report

The recorded run passed with peak total RAM of 0.54 GiB and zero stream sequence gaps. Per-instance p95 frame intervals were approximately 9.38–9.43 ms, comfortably under the 16.67 ms 60fps budget.

## Runtime cadence defaults

`CAPTURE_INTERVAL_MS` defaults to 8 ms so the local Node/WebSocket scheduler has headroom above the 60fps floor. `SOURCE_CAPTURE_INTERVAL_MS` defaults to 60000 ms so expensive mGBA screenshot/PNG/decode work does not interrupt the strict transport cadence during the measured minute. The stream repeats the latest decoded frame as compressed zero-tile deltas between source refreshes; keyframe requests still force a source capture for recovery.

For interactive visual freshness, lower `SOURCE_CAPTURE_INTERVAL_MS` after measuring the local machine. The strict report should be regenerated whenever these cadence knobs are changed.
