# grokemon Multi-Instance Gateway

A single-container gateway server that manages up to 10 mGBA emulator processes, providing a mGBA-http-compatible REST API and a real-time dashboard.

## Architecture

```text
Single Docker Container:
  Gateway (Node.js) HTTP :8787
    ├── child_process.spawn('mgba-sdl', ...) × N
    ├── TCP connections to localhost:888N
    └── fs.readFile('/tmp/frames/<id>/*.png')

  Xvfb :99
  /tmp/frames tmpfs
```

- **Gateway**: Node.js/TypeScript REST API + WebSocket dashboard.
- **mGBA processes**: spawned directly by the gateway with per-instance Lua loader files.
- **Lua sockets**: one localhost port per instance, starting at `BASE_LUA_PORT`.
- **Screenshots**: written by mGBA into `/tmp/frames/<instance-id>/` and read directly by Node.js.

No Docker socket, Docker API, `docker exec`, or sidecar emulator containers are required at runtime.

## Quick Start

### Prerequisites

- Docker
- A legal Game Boy ROM file

### Build and start

```bash
ROM_PATH=/absolute/path/to/roms docker compose -f docker/docker-compose.yml up -d --build
curl http://localhost:8787/health
```

The compose file mounts `${ROM_PATH:-.}/roms` at `/rom`. By default new instances load `/rom/game.gb`; override `ROM_PATH` in the service environment if your mounted filename differs.

### Create an emulator instance

```bash
curl -X POST -H "X-Admin-Token: your-secret-token" \
  -H "Content-Type: application/json" \
  http://localhost:8787/admin/instances
```

Example response:

```json
{"id":"...","token":"<32-char-hex>","status":"running"}
```

### Connect harness

Set in your `.env`:

```text
MGBA_HTTP_BASE_URL=http://localhost:8787/api/v1/<token>
```

### Dashboard

Open `http://localhost:8787/` in your browser.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Gateway HTTP port |
| `ADMIN_TOKEN` | `dev-admin-token` | Admin API secret |
| `MAX_INSTANCES` | `10` | Maximum emulator processes |
| `BASE_LUA_PORT` | `8888` | First localhost Lua socket port |
| `MGBA_BINARY` | `mgba-sdl` | mGBA executable used by the gateway |
| `LUA_SCRIPT_PATH` | `/app/mGBASocketServer.lua` | Main Lua socket server script path |
| `FRAME_DIR` | `/tmp/frames` | Per-instance screenshot root |
| `ROM_PATH` | _(none)_ | Default ROM path for new instances |
| `CAPTURE_INTERVAL_MS` | `100` | Dashboard screenshot interval (ms) |
| `JPEG_QUALITY` | `60` | Dashboard JPEG quality (1-100) |
| `WS_BACKPRESSURE_LIMIT` | `262144` | WebSocket buffered-byte cutoff |

## API Reference

### Admin API (requires `X-Admin-Token` header)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/instances` | Create new emulator instance |
| `GET` | `/admin/instances` | List all instances |
| `GET` | `/admin/instances/:id` | Get instance details |
| `DELETE` | `/admin/instances/:id` | Destroy instance |

### Game API (token in URL path)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/:token/core/currentframe` | Current frame number |
| `GET` | `/api/v1/:token/core/read8?address=0xADDR` | Read byte from RAM |
| `GET` | `/api/v1/:token/core/read16?address=0xADDR` | Read 16-bit from RAM |
| `GET` | `/api/v1/:token/core/readrange?address=0xADDR&length=N` | Read byte range |
| `POST` | `/api/v1/:token/mgba-http/button/tap?button=A` | Tap button |
| `POST` | `/api/v1/:token/mgba-http/button/hold?button=A&duration=15` | Hold button |
| `POST` | `/api/v1/:token/core/screenshot` | Capture screenshot (returns PNG) |
| `POST` | `/api/v1/:token/core/savestateslot?slot=N` | Save state |
| `POST` | `/api/v1/:token/core/loadstateslot?slot=N` | Load state |

### WebSocket

| Path | Description |
|------|-------------|
| `/ws/dashboard` | All instances binary JPEG frames |
| `/ws/instance/:token` | Single instance binary JPEG frames |

Binary frame format: `[1 byte: instance_index][4 bytes: timestamp_ms LE][rest: JPEG bytes]`

## Verification

```bash
pnpm install
pnpm typecheck
pnpm test
```
