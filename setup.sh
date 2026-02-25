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

# Detect homebrew prefix
HOMEBREW_PREFIX="$(brew --prefix 2>/dev/null || echo "/opt/homebrew")"

# MCP config (used by heartbeat daemon)
sed -e "s|__IGLOO_DIR__|$IGLOO_DIR|g" \
    "$IGLOO_DIR/mcp/mcp-config.json.template" > "$IGLOO_DIR/mcp/mcp-config.json"

# LaunchAgent plist
sed -e "s|__IGLOO_DIR__|$IGLOO_DIR|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    -e "s|__HOMEBREW_PREFIX__|$HOMEBREW_PREFIX|g" \
    "$IGLOO_DIR/daemon/com.igloo.heartbeat.plist.template" > "$IGLOO_DIR/daemon/com.igloo.heartbeat.plist"

# .claude/settings.json is committed to the repo (permissions are portable)
# .claude/settings.local.json has machine-specific MCP server paths (gitignored)
cat > "$IGLOO_DIR/.claude/settings.local.json" << LOCALSETTINGS
{
  "mcpServers": {
    "imsg": {
      "command": "node",
      "args": ["$IGLOO_DIR/mcp/imsg-server.js"]
    },
    "gog": {
      "command": "node",
      "args": ["$IGLOO_DIR/mcp/gog-server.js"]
    }
  }
}
LOCALSETTINGS

# TOOLS.md from template
cp "$IGLOO_DIR/core/TOOLS.md.example" "$IGLOO_DIR/core/TOOLS.md"
sed -i '' "s|\[filled by setup.sh\]|$IGLOO_DIR|g" "$IGLOO_DIR/core/TOOLS.md"

# Make heartbeat executable
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

# ── Launch Claude for interactive bootstrap ──────────────────────────────────

echo ""
echo "  Setup complete. Launching Claude for interactive bootstrap..."
echo "  Claude will ask you a few questions to personalize your Igloo."
echo ""
echo "  ────────────────────────────────────────────────────────────"
echo ""

cd "$IGLOO_DIR"
exec claude --append-system-prompt "This is your FIRST RUN. memory/MEMORY.md does not exist yet. Immediately begin the bootstrap process: read core/BOOTSTRAP.md and follow its instructions. Introduce yourself and start asking the user setup questions right now — do not wait for them to prompt you."
