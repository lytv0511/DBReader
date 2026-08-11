#!/usr/bin/env bash
# Starts the DBReader relay server.
#
# Usage:  ./start.sh [token] [port]
#   token   optional bearer token clients must send
#   port    listen port (default: 8787)
set -euo pipefail

cd "$(dirname "$0")"

TOKEN="${1:-}"
PORT="${2:-8787}"

fresh() {
    local bin="$1"
    [[ -x "$bin" ]] && ! find src Cargo.toml -newer "$bin" -print -quit 2>/dev/null | grep -q .
}

if fresh ./target/release/dbreader-relay; then
    BIN=./target/release/dbreader-relay
elif fresh ./target/debug/dbreader-relay; then
    BIN=./target/debug/dbreader-relay
else
    echo "Building relay (first run or sources changed)..."
    cargo build --release
    BIN=./target/release/dbreader-relay
fi

ARGS=(--port "$PORT")
if [[ -n "$TOKEN" ]]; then
    ARGS+=(--token "$TOKEN")
fi

echo "Starting DBReader relay on port $PORT (Ctrl+C to stop)"
exec "$BIN" "${ARGS[@]}"
