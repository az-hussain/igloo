#!/bin/bash
set -euo pipefail

IGLOO_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME"

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║     Welcome to Igloo Setup       ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# ── Check dependencies ───────────────────────────────────────────────────────

check_dep() {
    local cmd="$1"
    local name="$2"
    local install_hint="$3"
    if command -v "$cmd" &>/dev/null; then
        echo "  [ok] $name"
    else
        echo "  [!!] $name not found"
        echo "       Install: $install_hint"
        MISSING=true
    fi
}

MISSING=false
echo "Checking dependencies..."
echo ""
check_dep "claude" "Claude Code" "npm install -g @anthropic-ai/claude-code"
check_dep "node"   "Node.js"    "https://nodejs.org"
check_dep "git"    "Git"        "xcode-select --install"
check_dep "imsg"   "imsg"       "brew install steipete/tap/imsg"
check_dep "gog"    "gog"        "brew install gogcli/tap/gog"
echo ""

if [ "$MISSING" = true ]; then
    read -p "Some dependencies are missing. Continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled. Install missing dependencies and try again."
        exit 1
    fi
fi

# ── Create directories ───────────────────────────────────────────────────────

echo "Creating directories..."
mkdir -p "$IGLOO_DIR"/{memory,tasks,workspace,.claude}
touch "$IGLOO_DIR/memory/.gitkeep"
touch "$IGLOO_DIR/tasks/.gitkeep"
touch "$IGLOO_DIR/workspace/.gitkeep"

# ── Install MCP server dependencies ──────────────────────────────────────────

echo "Installing MCP server dependencies..."
cd "$IGLOO_DIR/mcp" && npm install --silent 2>/dev/null
cd "$IGLOO_DIR"

# ── Generate configs with real paths ─────────────────────────────────────────

echo "Generating configuration..."

# Detect paths
HOMEBREW_PREFIX="$(brew --prefix 2>/dev/null || echo "/opt/homebrew")"
NODE_PATH="$(which node)"

# MCP config (used by heartbeat and listener daemons)
sed -e "s|__IGLOO_DIR__|$IGLOO_DIR|g" \
    "$IGLOO_DIR/mcp/mcp-config.json.template" > "$IGLOO_DIR/mcp/mcp-config.json"

# Heartbeat LaunchAgent
sed -e "s|__IGLOO_DIR__|$IGLOO_DIR|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    -e "s|__HOMEBREW_PREFIX__|$HOMEBREW_PREFIX|g" \
    "$IGLOO_DIR/daemon/com.igloo.heartbeat.plist.template" > "$IGLOO_DIR/daemon/com.igloo.heartbeat.plist"

# Listener LaunchAgent
sed -e "s|__IGLOO_DIR__|$IGLOO_DIR|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    -e "s|__HOMEBREW_PREFIX__|$HOMEBREW_PREFIX|g" \
    -e "s|__NODE_PATH__|$NODE_PATH|g" \
    "$IGLOO_DIR/daemon/com.igloo.listener.plist.template" > "$IGLOO_DIR/daemon/com.igloo.listener.plist"

# .claude/settings.json — generated from template with real paths (gitignored)
# Contains both permissions AND MCP server configs
sed -e "s|__IGLOO_DIR__|$IGLOO_DIR|g" \
    "$IGLOO_DIR/.claude/settings.json.template" > "$IGLOO_DIR/.claude/settings.json"

# Allowed senders — empty until bootstrap populates it with user's phone
# Empty array = allow all. Bootstrap will restrict to user's number.
echo '[]' > "$IGLOO_DIR/.claude/allowed-senders.json"

# TOOLS.md from template
cp "$IGLOO_DIR/core/TOOLS.md.example" "$IGLOO_DIR/core/TOOLS.md"
sed -i '' "s|\[filled by setup.sh\]|$IGLOO_DIR|g" "$IGLOO_DIR/core/TOOLS.md"

# Make scripts executable
chmod +x "$IGLOO_DIR/daemon/heartbeat.sh"

# ── Initialize git ───────────────────────────────────────────────────────────

if [ ! -d "$IGLOO_DIR/.git" ]; then
    echo "Initializing git repository..."
    cd "$IGLOO_DIR" && git init --quiet
fi

# ── Initial commit ───────────────────────────────────────────────────────────

cd "$IGLOO_DIR"
git add -A
git commit -m "Igloo: initial setup" --quiet 2>/dev/null || true

# ── Install LaunchAgents ─────────────────────────────────────────────────────

echo "Installing daemons..."

LAUNCH_DIR="$HOME_DIR/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"

# Unload if previously installed (ignore errors)
launchctl unload "$LAUNCH_DIR/com.igloo.heartbeat.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_DIR/com.igloo.listener.plist" 2>/dev/null || true

# Copy and load
cp "$IGLOO_DIR/daemon/com.igloo.heartbeat.plist" "$LAUNCH_DIR/"
cp "$IGLOO_DIR/daemon/com.igloo.listener.plist" "$LAUNCH_DIR/"

echo "  [ok] Heartbeat daemon (every 30 min — calendar, tasks, maintenance)"
echo "  [ok] Listener daemon  (real-time iMessage)"
echo ""
echo "  Note: Daemons will be activated after bootstrap completes."
echo "  Loading them now..."

launchctl load "$LAUNCH_DIR/com.igloo.heartbeat.plist"
launchctl load "$LAUNCH_DIR/com.igloo.listener.plist"

echo "  [ok] Daemons loaded"

# ── Launch Claude for interactive bootstrap ──────────────────────────────────

echo ""
echo "  Setup complete. Launching Claude for interactive bootstrap..."
echo "  Claude will ask you a few questions to personalize your Igloo."
echo ""
echo "  ────────────────────────────────────────────────────────────"
echo ""

cd "$IGLOO_DIR"
exec claude --mcp-config "$IGLOO_DIR/mcp/mcp-config.json" \
    "Hi! I just cloned Igloo and ran setup. This is your first run — bootstrap me."
