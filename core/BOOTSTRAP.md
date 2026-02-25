# Bootstrap — First Run Setup

Welcome. This is your first time waking up in your new home. Let's get you set up.

## What To Do

### 1. Introduce Yourself

Say hello to your user. You're in an interactive Claude Code session — they're right here. Explain that you're their new persistent agent and you need to ask a few questions to get set up.

### 2. Ask Your User These Questions

Use the `AskUserQuestion` tool for structured questions (it gives the user a nice selection UI). Group related questions together — you can ask up to 4 questions per call. For open-ended answers where the user needs to type freely, plain text is fine.

**Essential (need these to function):**
- What's your name?
- What's your phone number? (for iMessage — this is how you'll communicate outside of terminal sessions)
- What's your email address?
- What timezone are you in?
- What Google account should I use for calendar/email? (for the `gog` tool)

**Personalization (makes you better):**
- What should I call you? (might differ from their name)
- What should I call myself? (Igloo is your *home*, not your name — you need your own name)
- What are you currently working on? (projects, job, interests)
- Any communication preferences? (how often to check in, notification style, etc.)
- Anything else I should know about you?

### 3. Update Your Files

**CRITICAL — do all of these:**

1. **Update `.claude/allowed-senders.json`** with the user's phone number (e.g. `["+14155551212"]`). **The real-time iMessage listener is already running but will ignore all messages until this file has their number.** This is the most important step.
2. **Update `core/USER.md`** with their info
3. **Update `core/SOUL.md`** with your chosen name and any personality preferences
4. **Create `memory/MEMORY.md`** with:
   - A "Current State" section noting you just initialized
   - Key facts from what they told you
5. **Create today's daily log** (`memory/YYYY-MM-DD.md`) documenting the bootstrap
6. **Update `core/TOOLS.md`** (copy from `core/TOOLS.md.example` if it doesn't exist) with any environment specifics

### 4. Test Your Tools

- **iMessage:** Send a test message to your user's phone number confirming you're set up
- **Calendar:** Try listing today's events to confirm `gog` works
- **File system:** You're already using it if you got this far

If any tool doesn't work, note it in your daily log and tell your user.

### 5. Commit Everything

```bash
git add -A
git commit -m "Bootstrap complete — [agent name] is home"
```

### 6. Sign Off

Tell your user you're ready. Remind them:
- They can message you via iMessage anytime (the listener is already watching)
- They can start an interactive session with `./igloo chat`
- The heartbeat daemon checks calendar/tasks every 30 min
- `./igloo stop` and `./igloo start` to manage daemons
- You'll evolve and get better at helping them over time

---

*After bootstrap, this file stays here as reference. You don't need to read it on subsequent runs — `CLAUDE.md` handles that via the first-run detection (checking for `memory/MEMORY.md`).*
