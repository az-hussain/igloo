# Igloo

A persistent, autonomous Claude Code agent that lives on your Mac. It has memory, personality, access to your iMessages and Google services, and wakes up every 30 minutes to check on things.

Think of it as giving Claude a home.

## What It Does

- **Remembers** — Tiered memory system: hot memory always loaded, daily logs for raw events, topic files for deep knowledge
- **Communicates** — Sends and receives iMessages so you can talk to your agent from your phone
- **Monitors** — Checks your calendar, email, and tasks on a heartbeat schedule
- **Works** — Has a workspace directory for projects and file operations
- **Evolves** — Can edit its own instructions, personality, and capabilities over time

## Requirements

- macOS (uses LaunchAgent for daemon, iMessage for communication)
- [Claude Code](https://claude.com/claude-code) CLI
- [imsg](https://github.com/steipete/imsg) — iMessage CLI (`brew install steipete/tap/imsg`)
- [gog](https://github.com/gogcli/gog) — Google CLI (`brew install gogcli/tap/gog`)
- Node.js 18+
- Git

## Quick Start

```bash
# Clone the repo
git clone https://github.com/youruser/igloo.git ~/igloo
cd ~/igloo

# Run setup (checks deps, installs MCP servers, launches Claude)
./setup.sh
```

Setup will:
1. Check and report on dependencies
2. Install MCP server dependencies (`npm install`)
3. Generate machine-specific configs
4. Initialize a git repo
5. Launch Claude for interactive bootstrap

During bootstrap, Claude will ask your name, phone number, preferences, and then test its tools. After that, it's ready.

## Installing the Daemon

After bootstrap, install the heartbeat daemon so your agent stays active:

```bash
cp daemon/com.igloo.heartbeat.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.igloo.heartbeat.plist
```

Your agent will now wake up every 30 minutes to check messages, tasks, and calendar.

## Architecture

```
igloo/
├── CLAUDE.md                           # Auto-loaded by Claude Code every session
├── core/
│   ├── SOUL.md                         # Personality and principles
│   ├── USER.md                         # Your info and preferences
│   ├── HEARTBEAT.md                    # Dynamic checklist (agent-editable)
│   ├── BOOTSTRAP.md                    # First-run interactive setup
│   └── TOOLS.md.example                # Environment template
├── memory/
│   ├── MEMORY.md                       # Curated long-term knowledge
│   ├── YYYY-MM-DD.md                   # Daily logs
│   └── topics/                         # Deep-dive topic files
├── tasks/
│   └── tasks.jsonl                     # Append-only task log
├── mcp/
│   ├── imsg-server.js                  # iMessage MCP server
│   └── gog-server.js                   # Google services MCP server
├── daemon/
│   ├── heartbeat.sh                    # Heartbeat script
│   └── com.igloo.heartbeat.plist       # macOS LaunchAgent
└── workspace/                          # Agent's project directory
```

### Key Design Decisions

- **`CLAUDE.md` is the entry point** — Auto-loaded by Claude Code, provides progressive disclosure to deeper files
- **Files are instructions** — SOUL.md, USER.md, HEARTBEAT.md replace hardcoded behavior with editable files
- **Memory is tiered** — Hot (MEMORY.md), temporal (daily logs), archival (topic files)
- **Fresh sessions for heartbeats** — Each daemon invocation is independent; files ARE the context
- **MCP servers for tools** — Structured, typed access to imsg and gog instead of raw bash
- **Agent can evolve** — It has permission to edit its own instruction files and even its permissions

## Interactive Sessions

You can always start a conversation with your agent:

```bash
cd ~/igloo
claude
```

The agent will load CLAUDE.md, read its memory, and pick up where it left off.

## License

MIT
