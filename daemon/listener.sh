#!/bin/bash
set -euo pipefail

IGLOO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$IGLOO_DIR"

exec node "$IGLOO_DIR/daemon/listener.js"
