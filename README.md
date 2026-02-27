# Igloo

A persistent, autonomous Claude Code agent that lives on your Mac. It has memory, personality, access to your iMessages, and runs scheduled tasks via cron to check on things.

Think of it as giving Claude a home.

## What It Does

- **Remembers** — Tiered memory system: hot memory always loaded, daily logs for raw events, topic files for deep knowledge
- **Communicates** — Sends and receives iMessages so you can talk to your agent from your phone
- **Monitors** — Checks your calendar, email, and tasks on cron schedules
- **Works** — Has a workspace directory for projects and file operations
- **Evolves** — Can edit its own instructions, personality, and capabilities over time

## Requirements

- macOS (iMessage for communication)
- [Claude Code](https://claude.com/claude-code) CLI (`npm install -g @anthropic-ai/claude-code`)
- [imsg](https://github.com/steipete/imsg) — iMessage CLI (`brew install steipete/tap/imsg`)
- Node.js 18+
- Git

## Quick Start

```bash
# Clone the repo
git clone https://github.com/az-hussain/igloo.git ~/igloo

# Add to PATH (or symlink: ln -s ~/igloo/igloo /usr/local/bin/igloo)
export PATH="$HOME/igloo:$PATH"

# Start everything — setup, daemons, and bootstrap
igloo start
```

On first run, `igloo start` will:
1. Check dependencies and install MCP server packages
2. Create `~/.igloo/` with the agent's home directory structure
3. Generate machine-specific configs
4. Walk you through interactive setup — your name, phone, timezone, agent name
5. Verify tool access (iMessage Full Disk Access)
6. Launch a bootstrap conversation where your agent introduces itself
7. Start the listener daemon (scheduler + iMessage)

After bootstrap, the agent is live — message it via iMessage or start an interactive session.

## Architecture

Igloo separates **code** (the git repo) from **state** (the agent's home directory). This means you can `igloo upgrade` to pull new code without losing your agent's memory, personality, or configuration.

```
~/igloo/                            # CODE — git repo, safe to `git pull`
├── igloo                           # CLI entry point
├── CLAUDE.md                       # Agent instructions (copied to home)
├── VERSION                         # Semver version
├── core/
│   ├── BOOTSTRAP.md                # First-run instructions
│   ├── HEARTBEAT.md.default        # Default behavioral guidelines
│   ├── schedules.json.default      # Default empty schedules
│   └── TOOLS.md.template           # Environment template
├── daemon/
│   └── listener.js                 # Listener + scheduler daemon
├── mcp/
│   └── imsg-server.js              # iMessage MCP server
└── scripts/
    └── setup.js                    # Interactive CLI onboarding

~/.igloo/                           # STATE — agent's home, never touched by upgrades
├── CLAUDE.md                       # Copied from code on setup/upgrade
├── .claude/
│   ├── settings.json               # Generated from template
│   ├── session-id                  # Persistent session
│   ├── allowed-senders.json        # User config
│   ├── tools.json                  # Tool status
│   └── skills/                     # Agent-created skills
├── core/
│   ├── SOUL.md                     # Agent-owned personality
│   ├── USER.md                     # Agent-owned user info
│   ├── HEARTBEAT.md                # Agent-owned behavioral guidelines
│   ├── TOOLS.md                    # Generated from template
│   └── schedules.json              # Agent-owned schedules
├── memory/                         # Agent's brain
├── tasks/                          # Task checklist
├── workspace/                      # Agent projects
└── daemon/
    ├── listener.log                # Runtime logs
    └── listener.pid                # Runtime PID
```

## Permissions

Igloo runs Claude Code with `--dangerously-skip-permissions` so the agent can operate autonomously (read/write files, run commands, send messages) without manual approval on every action.

The agent's tool permissions are also configured in `~/.igloo/.claude/settings.json`. You can review and edit this file to adjust what it's allowed to do.

**iMessage access** requires Full Disk Access for Terminal.app (System Settings → Privacy & Security → Full Disk Access).

## Usage

### Interactive Sessions

```bash
igloo chat
```

Starts an interactive Claude session that forks from the persistent session history. Your conversation won't interfere with the listener's session.

### Daemon Management

```bash
igloo start     # Start listener daemon (runs setup if needed)
igloo stop      # Stop listener daemon
igloo restart   # Restart listener daemon
igloo status    # Show daemon status, paths, and version
igloo logs      # Tail daemon logs
```

### Upgrading

```bash
igloo upgrade
```

Pulls the latest code, reinstalls dependencies, updates CLAUDE.md and generated configs, and restarts the daemon. Your agent's memory, personality, and state are preserved.

### Migrating from v0.1 (single-directory layout)

If you have an existing Igloo instance where code and state live in the same directory, you need to do a one-time migration. First pull the new code manually (to get the `migrate` command), then run migration:

```bash
cd ~/igloo          # your code directory
igloo stop
git pull
igloo migrate       # moves state to ~/.igloo/
igloo start         # launch from new layout
```

After this, `igloo upgrade` handles all future updates.

### iMessage Commands

- **`/new`** — Reset the conversation. Sends a confirmation, and your next message starts a fresh session with full context re-injection.

## Key Design Decisions

- **Code/state separation** — Code directory is `git pull` safe; agent state lives in `~/.igloo/`
- **`CLAUDE.md` is the entry point** — Auto-loaded by Claude Code, provides progressive disclosure to deeper files
- **Files are instructions** — SOUL.md, USER.md, HEARTBEAT.md replace hardcoded behavior with editable files
- **Memory is tiered** — Hot (MEMORY.md), temporal (daily logs), archival (topic files)
- **Cron-based scheduling with persistent session** — Scheduled tasks flow through the same queue and session as messages
- **MCP servers for tools** — Structured, typed access to imsg instead of raw bash
- **Agent can evolve** — It has permission to edit its own instruction files and even its permissions

## Environment Variable

- `IGLOO_HOME` — Override the home directory (default: `~/.igloo/`)

## License

MIT
