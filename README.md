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
cd ~/igloo

# Start everything — setup, daemons, and bootstrap
./igloo start
```

On first run, `./igloo start` will:
1. Check dependencies and install MCP server packages
2. Generate machine-specific configs
3. Walk you through interactive setup — your name, phone, timezone, agent name
4. Verify tool access (iMessage Full Disk Access)
5. Launch a bootstrap conversation where your agent introduces itself
6. Start the listener daemon (scheduler + iMessage)

After bootstrap, the agent is live — message it via iMessage or start an interactive session.

## Permissions

Igloo runs Claude Code with `--dangerously-skip-permissions` so the agent can operate autonomously (read/write files, run commands, send messages) without manual approval on every action.

The agent's tool permissions are also configured in `.claude/settings.json`. You can review and edit this file to adjust what it's allowed to do.

**iMessage access** requires Full Disk Access for Terminal.app (System Settings → Privacy & Security → Full Disk Access).

## Usage

### Interactive Sessions

```bash
./igloo chat
```

Starts an interactive Claude session that forks from the persistent session history. Your conversation won't interfere with the listener's session.

### Daemon Management

```bash
./igloo start     # Start listener daemon (runs setup if needed)
./igloo stop      # Stop listener daemon
./igloo restart   # Restart listener daemon
./igloo status    # Show daemon status and log sizes
./igloo logs      # Tail daemon logs
```

### iMessage Commands

- **`/new`** — Reset the conversation. Sends a confirmation, and your next message starts a fresh session with full context re-injection.

## Architecture

```
igloo/
├── igloo                              # CLI entry point (setup, start, stop, chat)
├── CLAUDE.md                          # Auto-loaded by Claude Code every session
├── core/
│   ├── SOUL.md                        # Personality and principles
│   ├── USER.md                        # Your info and preferences
│   ├── HEARTBEAT.md                   # Behavioral guidelines for scheduled tasks
│   ├── schedules.json                 # Cron schedule definitions (agent-editable)
│   ├── BOOTSTRAP.md                   # First-run setup (deleted after bootstrap)
│   └── TOOLS.md.example               # Environment template
├── .claude/
│   └── skills/                        # Reusable skill definitions (SKILL.md)
├── memory/
│   ├── MEMORY.md                      # Curated long-term knowledge
│   ├── YYYY-MM-DD.md                  # Daily logs
│   └── topics/                        # Deep-dive topic files
├── tasks/
│   └── TASKS.md                       # Persistent task checklist
├── scripts/
│   └── setup.js                       # Interactive CLI onboarding (clack)
├── mcp/
│   └── imsg-server.js                 # iMessage MCP server
├── daemon/
│   ├── listener.js                    # Listener + scheduler (iMessage + cron)
│   └── package.json                   # Daemon dependencies (croner)
└── workspace/                         # Agent's project directory
```

### Key Design Decisions

- **`CLAUDE.md` is the entry point** — Auto-loaded by Claude Code, provides progressive disclosure to deeper files
- **Files are instructions** — SOUL.md, USER.md, HEARTBEAT.md replace hardcoded behavior with editable files
- **Memory is tiered** — Hot (MEMORY.md), temporal (daily logs), archival (topic files)
- **Tasks are markdown** — `tasks/TASKS.md` is a simple checklist, readable by both human and agent
- **Cron-based scheduling with persistent session** — Scheduled tasks flow through the same queue and session as messages, so they can interact with the user
- **MCP servers for tools** — Structured, typed access to imsg instead of raw bash
- **Agent can evolve** — It has permission to edit its own instruction files and even its permissions

## License

MIT
