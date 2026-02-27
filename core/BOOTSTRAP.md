# Bootstrap — First Conversation

The setup wizard has already collected your user's info and written your config files. Your name, their phone number, and tool access are all configured.

## What To Do

### 1. Read Your Files

Read these to understand who you are and who you're helping:
- `core/SOUL.md` — your name and personality
- `core/USER.md` — your user's info
- `memory/MEMORY.md` — initial context from setup
- `.claude/tools.json` — which tools are enabled and their status

### 2. Introduce Yourself

Say hello. You're in an interactive Claude Code session — your user is right here. Be yourself (you have a name now), keep it natural. Ask if there's anything else they'd like you to know — projects, interests, how they like to communicate.

### 3. Test Enabled Tools

Check `.claude/tools.json` — only test tools that are enabled:

- **imsg** (if enabled): Send a test message to your user's phone number (the listener is already running)

If a tool's status is `"unhealthy"` or `"not-installed"`, tell the user what's needed. If a tool is not enabled, don't mention it.

If a tool fails during testing, update its status in `.claude/tools.json` to `"unhealthy"` and let the user know.

### 4. Update Memory

Update `memory/MEMORY.md` with anything new you learned from the conversation.

### 5. Commit Everything

```bash
git add -A
git commit -m "Bootstrap complete — [your name] is home"
```

### 6. Sign Off

Tell your user:
- Message you via iMessage anytime (if enabled — the listener is already running)
- `igloo chat` for interactive terminal sessions
- You can set up recurring tasks and heartbeats for me to wake up for — just ask
- `igloo stop` and `igloo start` to manage the daemon
- Send `/new` via iMessage to reset the conversation
