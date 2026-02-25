# Igloo — Implementation Plan (Revised)

## Overview

Igloo is a persistent autonomous Claude Code agent that lives in a git repo on your Mac. It has memory, personality, iMessage communication, Google service access, and a heartbeat daemon. Anyone can clone the repo and run `setup.sh` to get their own persistent agent.

**Name:** Igloo — a self-contained home built for Claude.

---

## Architecture

### Entry Point: CLAUDE.md

Claude Code auto-loads `CLAUDE.md` from the project root on every invocation. This is the single most important file — it's the agent's operating manual, loaded every time it wakes up.

CLAUDE.md uses **progressive disclosure**:
- Contains the full operating loop (what to do each invocation)
- References deeper files only when needed (SOUL.md, USER.md, etc.)
- Keeps token cost per invocation low while maintaining full capability

### File Hierarchy

```
CLAUDE.md (always loaded)
  ├── core/HEARTBEAT.md (read every beat — the checklist)
  ├── memory/MEMORY.md (read every beat — curated knowledge)
  ├── memory/YYYY-MM-DD.md (read/create every beat — today's log)
  │
  ├── core/SOUL.md (read as needed — personality)
  ├── core/USER.md (read as needed — user info)
  ├── core/TOOLS.md (read as needed — environment)
  └── core/BOOTSTRAP.md (read on first run only)
```

### Memory System

Three tiers, each with different access patterns:

| Tier | File | When Read | Update Frequency |
|------|------|-----------|-----------------|
| Hot | `memory/MEMORY.md` | Every invocation | When important things happen |
| Temporal | `memory/YYYY-MM-DD.md` | Every invocation (today only) | Every interaction |
| Archival | `memory/topics/*.md` | On demand | When deep knowledge accumulates |

The agent distills daily logs into MEMORY.md every few days and prunes logs older than 30 days.

### Tool Access

Two MCP servers wrap CLI tools as structured, typed MCP tools:

**imsg MCP server** (4 tools):
- `list_chats` — List recent conversations
- `get_history` — Get message history for a chat
- `send_message` — Send iMessage/SMS
- `send_file` — Send a file/image

**gog MCP server** (11 tools):
- `gmail_search`, `gmail_get` — Read email
- `calendar_events`, `calendar_create`, `calendar_list` — Calendar management
- `contacts_search`, `contacts_list` — Contact lookup
- `drive_search`, `drive_list` — Google Drive access
- `tasks_lists`, `tasks_list` — Google Tasks

Both servers are Node.js using the official `@modelcontextprotocol/sdk`, with zero external deps beyond the SDK.

### Permission Model

**Project-level** (`.claude/settings.json`, committed to git):
```json
{
  "permissions": {
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep",
      "Bash(git:*)", "Bash(date:*)", "Bash(jq:*)",
      "mcp__imsg__*", "mcp__gog__*"
    ]
  }
}
```

**Machine-level** (`.claude/settings.local.json`, gitignored):
```json
{
  "mcpServers": {
    "imsg": { "command": "node", "args": ["/abs/path/mcp/imsg-server.js"] },
    "gog": { "command": "node", "args": ["/abs/path/mcp/gog-server.js"] }
  }
}
```

**Self-evolution**: The agent can edit `.claude/settings.json` to add new permissions. In interactive sessions, the user sees and approves the edit. In daemon mode, changes are committed to git for review.

### Daemon Architecture

**LaunchAgent** (native macOS daemon):
- Runs `daemon/heartbeat.sh` every 30 minutes
- Uses `claude --print` for non-interactive execution
- Uses `--permission-mode bypassPermissions` for autonomous operation
- Each heartbeat is a **fresh session** — no conversation history carried over
- The agent's files (CLAUDE.md, MEMORY.md, daily log) ARE the context

**Why fresh sessions?**
1. No growing conversation to manage or compress
2. Forces the agent to read its own memory (practices persistence)
3. No stale conversation context
4. More resilient — each beat is independent

### Bootstrap Flow

1. User clones repo and runs `./setup.sh`
2. Setup checks dependencies, installs MCP packages, generates configs
3. Setup launches `claude` interactively in the igloo directory
4. Claude reads CLAUDE.md, detects no `memory/MEMORY.md` (first run)
5. Claude reads `core/BOOTSTRAP.md` for first-run instructions
6. Claude asks the user questions conversationally:
   - Name, phone, email, timezone, Google account
   - Optional: agent name, communication preferences, current projects
7. Claude updates `core/USER.md` with answers
8. Claude creates `memory/MEMORY.md` and today's daily log
9. Claude tests tools (sends test iMessage, checks calendar)
10. Claude commits initialization to git
11. Claude tells user how to install the daemon

### Task Tracking

Simple append-only JSONL (`tasks/tasks.jsonl`):
```jsonl
{"ts":"2026-02-25T10:00:00Z","action":"created","task":"Review PR #42","due":"2026-02-25T16:00:00Z","priority":"high"}
{"ts":"2026-02-25T14:00:00Z","action":"completed","task":"Review PR #42","notes":"Approved with comments"}
```

No complex state machine. The agent reads the file, finds incomplete tasks, and acts on them. Simple and transparent.

---

## Design Decisions

### Why CLAUDE.md, not AGENTS.md?

Claude Code auto-loads `CLAUDE.md` from the project root. Any other filename requires the agent to explicitly read it every invocation, wasting tokens and adding fragility. CLAUDE.md is the native entry point.

### Why `.claude/settings.json` split into two files?

- `settings.json` is portable (permissions patterns, no absolute paths) → committed to git
- `settings.local.json` is machine-specific (MCP server paths) → gitignored, generated by setup.sh

### Why MCP servers instead of just allowing bash?

MCP servers give the agent:
- Structured parameters with Zod schemas
- Type validation before execution
- Proper tool descriptions for discovery
- Clean separation from raw shell access

The agent still has some bash access (`git`, `jq`, `date`) for operations that don't need a full MCP wrapper.

### Why fresh sessions for heartbeats?

Session resume (`--session-id` or `--continue`) would carry conversation history across heartbeats. This seems appealing but creates problems:
- Conversation grows indefinitely (compression loses context)
- Stale context from hours ago may confuse the agent
- If a session gets corrupted, all future beats are affected

Fresh sessions with file-based memory is more resilient and forces good memory hygiene.

### Why LaunchAgent, not cron?

LaunchAgent is the native macOS daemon mechanism:
- Survives logout/sleep properly
- Can set environment variables
- Runs at load (not just on schedule)
- Better logging integration
- `launchctl` for management

### Why 30-minute heartbeats?

- 48 beats/day is a reasonable balance
- Most beats are cheap (read files, check messages, exit)
- Active beats (actual work) cost more but are infrequent
- User can adjust the interval in the plist

### Why not separate the SOUL into the CLAUDE.md?

SOUL.md is the agent's personality — something it should be able to evolve independently. Keeping it separate from the operating manual (CLAUDE.md) means the agent can change its voice without risking its operating instructions.

---

## Cost Estimates

| Beat Type | Frequency | Cost per Beat | Daily Cost |
|-----------|-----------|--------------|------------|
| Quiet (nothing new) | ~35/day | $0.03-0.08 | $1-3 |
| Active (messages, tasks) | ~10/day | $0.10-0.50 | $1-5 |
| Heavy (project work) | ~3/day | $0.50-2.00 | $1.50-6 |
| **Total** | **48/day** | | **$3-14/day** |

Main cost driver: input tokens from CLAUDE.md + MEMORY.md + daily log loaded every beat. Keeping these files concise directly reduces cost.

---

## Future Directions

1. **More MCP servers** — Slack, GitHub, Linear, etc.
2. **Proactive scheduling** — Agent creates its own calendar events for follow-ups
3. **Multi-agent** — Multiple igloo instances that can message each other
4. **Web dashboard** — Simple web UI showing agent status, memory, and tasks
5. **Linux support** — systemd unit file for non-macOS users
6. **Remote access** — SSH tunnel or similar for accessing igloo from other machines
