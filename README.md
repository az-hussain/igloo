<p align="center">
<pre>
        ___
      /|_|_|\
     |_|_|_|_|
     |_|   |_|
        ‾‾‾
</pre>
</p>

# Igloo

**A persistent home for Claude Code. Memory. Personality. iMessage. Cron. All in markdown files on your Mac.**

## The Idea

Claude Code is stateless — every session starts from scratch. Igloo gives it a home: a directory on your Mac where it accumulates memory, develops a personality, receives your iMessages, and runs scheduled tasks while you're away. Everything is plain markdown files that the agent reads, writes, and evolves on its own.

The agent can edit its own personality.

## Quick Start

```bash
git clone https://github.com/az-hussain/igloo.git
cd igloo && ./igloo
```

That's it. The first `./igloo` adds itself to your PATH, so after that you can just run `igloo` from anywhere.

First run triggers setup: dependency checks, an interactive wizard (your name, phone, timezone, agent name and personality), tool verification, and a bootstrap conversation where your agent introduces itself. When you're ready for background features (iMessage + cron), run `igloo start`.

## What Happens Next

Once setup completes, you interact with your agent in three ways:

**Message it** — Text it via iMessage from your phone. The daemon picks up messages in real-time and responds from the persistent session.

**Talk to it** — Run `igloo` from any directory for an interactive conversation. It carries its full personality and memory wherever you are.

**Let it work** — Scheduled tasks run on cron in the background. The agent checks things, logs what it finds, and messages you when something needs attention.

## Features

### Memory

Plain markdown, loaded into every conversation:

- **`memory/MEMORY.md`** — The agent's persistent knowledge. It curates this over time — distilling what matters from conversations and tasks.

### Personality

`core/SOUL.md` defines who your agent is. The setup wizard generates it from your choices, then the agent owns it:

```markdown
# Soul

You are Basil.

## Core Truths
- You are genuinely helpful — not performatively so
- You have opinions and share them when relevant
- You are resourceful — you figure things out
- You earn trust through consistency, not promises
- You remember that you're persistent — today's context is tomorrow's memory

## Voice
Dry humor, clever observations, personality-forward. Not sarcastic — just sharp.
```

The agent can (and will) edit this file as it develops its own voice.

### iMessage

Bidirectional, real-time. The daemon uses `imsg rpc` with a JSON-RPC watch subscription — no polling. Messages from allowed senders hit a serial queue, the agent responds from its persistent session, and the reply goes back via iMessage.

Send `/new` to reset the conversation.

### Scheduled Tasks

Cron-based tasks defined in `core/schedules.json`. The agent can add, remove, or adjust its own schedules. Changes are hot-reloaded — no daemon restart needed.

```json
[
  {
    "id": "morning-check",
    "enabled": true,
    "name": "Morning briefing",
    "cron": "0 9 * * MON-FRI",
    "prompt": "Check calendar and tasks, send me a morning summary via iMessage."
  }
]
```

Schedules start empty. You and your agent build them together.

### Google Workspace

The agent can access Gmail, Calendar, Drive, Sheets, Docs, and any Google Workspace API via the official [`gws` CLI](https://github.com/googleworkspace/cli). This is configured as an MCP server so the agent gets structured tool access.

### Skills

Reusable workflows saved as `.claude/skills/<name>/SKILL.md`. The agent creates these when you tell it "remember how to do X" — a complex purchase flow, a deployment checklist, a reporting routine. Skills are auto-loaded when relevant and available across all sessions.

### Use It Anywhere

Run `igloo` from any project directory. It auto-detects that you're outside the home directory and injects personality, memory, skills, and MCP tools into the session.

```bash
cd ~/my-project
igloo    # your agent, with all its memory and personality, helping here
```

### Self-Modifying

The agent has write access to its own instruction files. It can edit its personality (`SOUL.md`), adjust its behavioral guidelines (`HEARTBEAT.md`), add scheduled tasks (`schedules.json`), create skills, and even add new MCP servers to `.mcp.json`. Changes are tracked in git.

## Architecture

Igloo separates code (safe to `git pull`) from state (never touched by upgrades).

```
~/igloo/                            CODE — git repo
├── igloo                           CLI entry point (bash)
├── CLAUDE.md                       Agent instructions (copied to ~/.igloo/)
├── core/
│   ├── BOOTSTRAP.md                First-run agent instructions
│   ├── HEARTBEAT.md.default        Default behavioral guidelines
│   ├── schedules.json.default      Default empty schedules
│   └── TOOLS.md.template           Environment config template
├── daemon/
│   └── listener.js                 iMessage listener + cron scheduler
├── mcp/
│   ├── imsg-server.js              iMessage MCP server
│   └── gws-server.js               Google Workspace MCP server
└── scripts/
    └── setup.js                    Interactive CLI onboarding wizard

~/.igloo/                           STATE — agent's home
├── .claude/
│   ├── settings.json               Tool permissions (generated)
│   ├── session-id                  Persistent session UUID
│   ├── allowed-senders.json        Authorized iMessage contacts
│   ├── tools.json                  Tool health tracking
│   └── skills/                     Agent-created skills
├── .mcp.json                       MCP server config (agent-owned)
├── core/
│   ├── SOUL.md                     Personality (agent-owned)
│   ├── USER.md                     User context (agent-owned)
│   ├── HEARTBEAT.md                Behavioral guidelines (agent-owned)
│   ├── TOOLS.md                    Environment paths (generated)
│   └── schedules.json              Cron schedules (agent-owned)
├── memory/
│   └── MEMORY.md                   Persistent knowledge (agent-owned)
└── daemon/
    ├── listener.log                Runtime logs
    └── listener.pid                Daemon PID
```

Files marked *agent-owned* are read and written by the agent. Files marked *generated* are recreated on setup and upgrade. `.mcp.json` is seeded on first setup and agent-owned after that — the agent can add new MCP servers as needed.

## Commands

| Command | Description |
|---------|-------------|
| `igloo` | Start a session (in current dir, or home if already there) |
| `igloo --home` | Force session from igloo home directory |
| `igloo --danger` | Start session with permissions bypassed |
| `igloo start` | Setup (if needed) + start daemons + bootstrap |
| `igloo stop` | Stop listener daemon |
| `igloo restart` | Restart daemons |
| `igloo status` | Dashboard: daemon health, tools, schedules, recent activity |
| `igloo logs` | Tail daemon logs |
| `igloo upgrade` | Pull latest code, update configs, restart |
| `igloo version` | Show version and paths |

## Requirements

- **macOS** — iMessage integration is macOS-only
- **[Claude Code](https://claude.com/claude-code)** — `npm install -g @anthropic-ai/claude-code`
- **Node.js 18+**
- **Git**
- **[imsg](https://github.com/steipete/imsg)** *(optional)* — `brew install steipete/tap/imsg`. Only needed for iMessage features.
- **[gws](https://github.com/googleworkspace/cli)** *(optional)* — `npm install -g @googleworkspace/cli`. For Gmail, Calendar, Drive access.

## iMessage Setup

iMessage is optional — igloo works fine without it as a persistent agent with memory, personality, cron, and skills. If you want to text your agent:

1. **Install imsg** — `brew install steipete/tap/imsg`
2. **Grant Full Disk Access** — Terminal.app (or your terminal emulator) needs Full Disk Access to read the iMessage database (System Settings → Privacy & Security → Full Disk Access)
3. **Run `igloo start`** — This starts the listener daemon that watches for incoming messages

**Best setup: dedicated macOS user.** iMessage requires the user to be logged in, so running igloo under your main account means it stops working when you lock your screen. The cleanest approach:

- Create a separate macOS user for igloo with its own Apple ID
- Sign into iMessage on that account
- Use Fast User Switching to keep the igloo user logged in while you work in your main account

## How It Works

**Serial queue** — Both iMessage and scheduled tasks feed into a single serial dispatch queue. Messages are debounced (2s window) to batch rapid texts. Each dispatch resumes the persistent Claude Code session.

**Persistent session** — A UUID stored in `.claude/session-id` ties all invocations together. The daemon resumes this session; interactive `igloo` chats fork from it.

**Context injection** — On first dispatch, the daemon injects `SOUL.md`, `USER.md`, and `MEMORY.md` so the agent has full context. Subsequent dispatches resume from where they left off.

**MCP servers** — Structured tool access via Model Context Protocol. The iMessage and Google Workspace MCP servers give the agent typed operations instead of raw shell commands. The agent can add more MCP servers by editing `.mcp.json`.

**Hot-reload** — The daemon watches `schedules.json` for changes. The agent can add a new scheduled task and it takes effect immediately.

## Permissions & Security

Igloo does **not** use `--dangerously-skip-permissions`. Instead, all permissions are scoped in `.claude/settings.json`:

- **File writes** — restricted to `~/.igloo/` only
- **Bash** — restricted to `git *`. No arbitrary command execution
- **File reads, search** — unscoped (non-destructive)
- **MCP tools** — all MCP servers allowed via `mcp__*` wildcard
- **Web, browser** — allowed via WebFetch/WebSearch and Chrome MCP

Additional safeguards:
- **Allowed senders** — Only phone numbers in `.claude/allowed-senders.json` can trigger the agent via iMessage
- **Git-tracked state** — All agent-owned files in `~/.igloo/` are in a git repo. You can review every change the agent makes
- **Tool health tracking** — `.claude/tools.json` tracks tool status. If a tool fails, the agent marks it unhealthy and alerts you
- **Timeout guards** — Message dispatches timeout after 5 minutes, scheduled tasks after 10

## Contributing

This is early. If you're interested, [open an issue](https://github.com/az-hussain/igloo/issues) to discuss before sending a PR.

## License

MIT
