#!/bin/bash
set -e

cleanup() {
    echo "Shutting down..."
    kill $(jobs -p) 2>/dev/null || true
    wait
}
trap cleanup EXIT INT TERM

echo "Starting Xvfb..."
Xvfb :99 -screen 0 1024x768x24 -ac &

for i in $(seq 1 30); do
    if DISPLAY=:99 xdpyinfo >/dev/null 2>&1; then
        echo "Display ready"
        break
    fi
    sleep 0.5
done

export DISPLAY=:99

echo "Starting gateway..."
exec node /app/dist/index.js
