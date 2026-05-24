# pss-mgba Multi-Instance Gateway

A gateway server that manages up to 10 mGBA emulator instances via Docker, providing a mGBA-http-compatible REST API and a real-time dashboard.

## Architecture

- **Gateway** (Node.js/TypeScript): REST API + WebSocket dashboard, manages emulator containers via Docker API
- **Emulator containers** (Debian + Xvfb + mGBA): each runs headlessly with Lua socket server on port 8888
- **Protocol**: the gateway speaks directly to mGBA's Lua socket; no .NET mGBA-http binary is needed

## Quick Start

### Prerequisites

- Docker with the Docker socket accessible
- mGBA emulator image built: `docker build -t pss-mgba-emulator docker/emulator/`
- A legal Pokemon ROM file

### Start the gateway

```bash
# Build emulator image first
docker build -t pss-mgba-emulator docker/emulator/

# Build and start the gateway
docker compose -f docker/docker-compose.yml up -d --build

# Verify
curl http://localhost:8787/health
```

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
| `MAX_INSTANCES` | `10` | Maximum emulator instances |
| `EMULATOR_IMAGE` | `pss-mgba-emulator` | Docker image for emulators |
| `NETWORK_NAME` | `pss-mgba-net` | Docker network name |
| `ROM_PATH` | _(none)_ | Default ROM path for new instances |
| `CAPTURE_INTERVAL_MS` | `100` | Screenshot interval (ms) |
| `JPEG_QUALITY` | `60` | Dashboard JPEG quality (1-100) |

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
