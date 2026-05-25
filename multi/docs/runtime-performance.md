# Runtime/container performance path

This runtime path keeps the mGBA core unchanged and optimizes the local container/runtime path used by the 10-instance benchmark.

## Capture readback

Each emulator container gets a host directory mounted at `/capture`. This requires the gateway process and Docker daemon to share the same local host filesystem; remote Docker daemons are not a supported benchmark topology for this capture path. The integrity boundary is the local Docker daemon and the gateway-owned capture root, not untrusted containers or remote daemon hosts:

```text
${CAPTURE_ROOT:-/tmp/pss-mgba-captures}/<instance-id>:/capture:rw
```

The gateway creates the capture root and per-instance directories as owner-only `0700` directories, rejects symlinked/non-directory capture paths, and stores canonical host paths in container labels.

`FrameCapture` asks mGBA to write `/capture/frame.png` and then reads `<capture-root>/<instance-id>/frame.png` directly from the host filesystem. The REST screenshot endpoint uses `/capture/rest-capture.png` the same way. This removes a `docker exec cat` subprocess from source refreshes and avoids routing PNG bytes through the Docker CLI during the streaming hot path. Between source refreshes, the stream repeats the latest decoded frame as compressed zero-tile deltas so WebSocket delivery cadence stays independent of slower screenshot/PNG/decode work.

## Container limits

`DockerDriver` applies bounded runtime settings per emulator container:

- memory and swap cap from `EMULATOR_MEMORY_BYTES`, default `805306368` bytes
- `/tmp` tmpfs capped at 32 MiB and `/run` tmpfs capped at 8 MiB
- 32 MiB shared memory segment
- pids limit of 128
- dummy SDL audio driver
- compact `XVFB_SCREEN=320x240x16` display
- `CAPTURE_INTERVAL_MS=8` emitted-frame cadence by default
- `SOURCE_CAPTURE_INTERVAL_MS=60000` source refresh interval by default for strict transport stability

CPU is intentionally not capped here because the benchmark is measuring whether the local runtime can sustain the target cadence. These limits are intentionally per-container and preserve the existing max-10 instance cap. They do not prove the sustained target by themselves; the strict benchmark remains the acceptance gate.

## Cleanup and reconstruction

`InstanceManager.destroy()` removes the per-instance capture directory after stopping the container. Managed containers carry a `pss-mgba.capture-directory` label so reconstruction can restore the host capture path when the gateway starts with existing managed containers. Reconstruction stops legacy or unsafe managed containers instead of adopting them. Cleanup rejects capture directories outside the configured `CAPTURE_ROOT`; if a stale label points outside the root, the container is stopped but that outside path is left for manual operator cleanup. Screenshot reads reject symlinks, non-regular files, and oversized capture files before reading bytes.
