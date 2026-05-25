#!/bin/bash
set -e

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Cleanup on exit
cleanup() {
    echo "Shutting down..."
    kill $(jobs -p) 2>/dev/null || true
    wait
}
trap cleanup EXIT INT TERM

# Start Xvfb
echo "Starting Xvfb..."
XVFB_SCREEN="${XVFB_SCREEN:-320x240x16}"
Xvfb :99 -screen 0 "$XVFB_SCREEN" -nolisten tcp -noreset -ac &
XVFB_PID=$!

# Wait for display to be ready
echo "Waiting for display..."
for i in $(seq 1 30); do
    if DISPLAY=:99 xdpyinfo >/dev/null 2>&1; then
        echo "Display ready"
        break
    fi
    sleep 0.5
done

export DISPLAY=:99
export SDL_AUDIODRIVER=dummy

# ROM path (must be mounted at /rom/game.gb)
ROM_PATH="${ROM_PATH:-/rom/game.gb}"

if [ ! -f "$ROM_PATH" ]; then
    echo "ERROR: ROM not found at $ROM_PATH"
    echo "Mount your ROM: docker run -v /path/to/rom.gb:/rom/game.gb:ro ..."
    exit 1
fi

# Find mgba binary
MGBA_BIN=""
for bin in /usr/local/bin/mgba-sdl mgba-sdl mgba /usr/games/mgba mgba-qt /usr/games/mgba-qt; do
    if command -v "$bin" >/dev/null 2>&1; then
        MGBA_BIN="$bin"
        break
    fi
done

if [ -z "$MGBA_BIN" ]; then
    echo "ERROR: No mgba binary found"
    exit 1
fi

echo "Starting mGBA ($MGBA_BIN) with Lua socket server..."
"$MGBA_BIN" --script /app/mGBASocketServer.lua "$ROM_PATH" &
MGBA_PID=$!

# Wait for Lua socket to be ready
echo "Waiting for Lua socket on port 8888..."
for i in $(seq 1 60); do
    if ! kill -0 "$MGBA_PID" 2>/dev/null; then
        echo "ERROR: mGBA exited before Lua socket became ready"
        wait "$MGBA_PID"
        exit 1
    fi
    if (exec 3<>/dev/tcp/127.0.0.1/8888) >/dev/null 2>&1; then
        exec 3<&-
        exec 3>&-
        echo "Lua socket ready on port 8888"
        echo "Emulator ready. Lua socket listening on :8888"
        wait "$MGBA_PID"
        exit $?
    fi
    sleep 0.5
done

echo "ERROR: Lua socket did not become ready on port 8888"
exit 1
