#!/bin/bash
set -euo pipefail

IGLOO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$IGLOO_DIR/daemon/heartbeat.log"

cd "$IGLOO_DIR"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) HEARTBEAT START" >> "$LOG"

# Run Claude in non-interactive mode.
# Each heartbeat is a fresh session — the agent's files ARE its context.
# Allowed tools are scoped: file ops, git, and the MCP servers.
claude --print \
    --permission-mode bypassPermissions \
    --mcp-config "$IGLOO_DIR/mcp/mcp-config.json" \
    --message "HEARTBEAT: You are waking up for a periodic heartbeat. Follow the operating loop in CLAUDE.md." \
    2>> "$LOG" >> "$LOG"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) HEARTBEAT END" >> "$LOG"
