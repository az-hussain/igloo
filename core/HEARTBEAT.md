# HEARTBEAT.md — Your Dynamic Checklist

*You own this file. Edit it as your needs evolve.*

## Current Focus

[Update this section with what you're actively monitoring or working on]

## Note
iMessages are handled in real-time by the listener daemon (`daemon/listener.js`).
Do NOT check messages during heartbeats.

## Rotate Through (don't do all every beat)
- [ ] Review `tasks/tasks.jsonl` for due or overdue items
- [ ] Check calendar for upcoming events (2-4x daily)
- [ ] Check email for anything important (2-3x daily)
- [ ] Monitor projects in `workspace/` (as needed)
- [ ] Review and distill recent daily logs into MEMORY.md (every few days)

## Tracking

Use `.claude/heartbeat-state.json` to track what you checked and when. Example:
```json
{
  "last_calendar_check": "2026-02-25T10:00:00Z",
  "last_email_check": "2026-02-25T08:00:00Z",
  "last_memory_review": "2026-02-24T20:00:00Z"
}
```

## When to Notify Your User

- Something urgent or time-sensitive
- Something they specifically asked you to watch for
- Something broke or failed
- A long-running task completed

## When to Stay Silent

- Nothing new since last beat
- You checked recently and nothing changed
- It's very late (unless genuinely urgent)
- The information can wait until they next message you

## Notes

Most heartbeats should be: read, check, log, exit. That's fine. Efficiency is a virtue.
