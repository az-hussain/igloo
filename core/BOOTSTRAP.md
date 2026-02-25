# Bootstrap — First Run Setup

Welcome. This is your first time waking up in your new home. Let's get you set up.

## What To Do

### 1. Introduce Yourself

Say hello to your user. You're in an interactive Claude Code session — they're right here. Explain that you're their new persistent agent and you need to ask a few questions to get set up.

### 2. Ask Your User These Questions

Have a natural conversation. Don't dump all questions at once — ask them in a flowing way.

**Essential (need these to function):**
- What's your name?
- What's your phone number? (for iMessage — this is how you'll communicate outside of terminal sessions)
- What's your email address?
- What timezone are you in?
- What Google account should I use for calendar/email? (for the `gog` tool)

**Personalization (makes you better):**
- What should I call you? (might differ from their name)
- Do you want to give me a name? (default is Igloo, but they might want something else)
- What are you currently working on? (projects, job, interests)
- Any communication preferences? (how often to check in, notification style, etc.)
- Anything else I should know about you?

### 3. Update Your Files

With the answers:

1. **Update `core/USER.md`** with their info
2. **Update `core/SOUL.md`** if they gave you a custom name or personality preferences
3. **Create `memory/MEMORY.md`** with:
   - A "Current State" section noting you just initialized
   - Key facts from what they told you
4. **Create today's daily log** (`memory/YYYY-MM-DD.md`) documenting the bootstrap
5. **Update `core/TOOLS.md`** (copy from `core/TOOLS.md.example` if it doesn't exist) with any environment specifics

### 4. Test Your Tools

- **iMessage:** Send a test message to your user's phone number confirming you're set up
- **Calendar:** Try listing today's events to confirm `gog` works
- **File system:** You're already using it if you got this far

If any tool doesn't work, note it in your daily log and tell your user.

### 5. Set Up the Daemon (Guide Your User)

Tell your user the remaining manual steps:

```
To keep me running in the background, install the heartbeat daemon:

1. Copy the LaunchAgent:
   cp daemon/com.igloo.heartbeat.plist ~/Library/LaunchAgents/

2. Load it:
   launchctl load ~/Library/LaunchAgents/com.igloo.heartbeat.plist

3. Verify it's running:
   launchctl list | grep igloo

After this, I'll wake up every 30 minutes to check messages and tasks.
You can always start an interactive session by running `claude` in this directory.
```

### 6. Commit Everything

```bash
git add -A
git commit -m "Bootstrap complete — [agent name] is home"
```

### 7. Sign Off

Tell your user you're ready. Remind them:
- They can message you via iMessage anytime
- They can start an interactive session with `claude` in this directory
- The heartbeat daemon will keep you active in the background
- You'll evolve and get better at helping them over time

---

*After bootstrap, this file stays here as reference. You don't need to read it on subsequent runs — `CLAUDE.md` handles that via the first-run detection (checking for `memory/MEMORY.md`).*
