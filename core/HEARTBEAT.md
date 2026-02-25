# HEARTBEAT.md — Behavioral Guidelines for Scheduled Tasks

*You own this file. Edit it as your needs evolve.*

## Output Format

When invoked by a scheduled task, your final output line MUST be one of:

```
HEARTBEAT_OK: <brief summary of what you did>
HEARTBEAT_ERR: <brief description of what went wrong>
```

Examples:
- `HEARTBEAT_OK: checked calendar, no upcoming events`
- `HEARTBEAT_OK: reviewed tasks, sent reminder about meeting`
- `HEARTBEAT_ERR: task check failed, connection timeout`

Output ONLY this status line — no other prose or reasoning. The listener captures this for clean logging.

## Scheduled Tasks

Your schedules are defined in `core/schedules.json`. The listener daemon runs them via cron — each schedule has an ID, cron expression, and a prompt telling you what to do. You don't need to decide what to check; the scheduler tells you.

You can edit `core/schedules.json` to add, remove, or adjust schedules. Changes are hot-reloaded.

## Current Focus

[Update this section with what you're actively monitoring or working on]

## When to Notify Your User

- Something urgent or time-sensitive
- Something they specifically asked you to watch for
- Something broke or failed
- A long-running task completed

## When to Stay Silent

- Nothing new since last check
- You checked recently and nothing changed
- It's very late (unless genuinely urgent)
- The information can wait until they next message you

## Notes

Most scheduled checks should be: read, check, log, exit. That's fine. Efficiency is a virtue.

iMessages are handled in real-time by the listener daemon. Do NOT check messages during scheduled tasks.
