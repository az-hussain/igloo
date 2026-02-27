---
name: process-meeting
description: Process a meeting transcript into high-value meeting notes
---

# Process Meeting Transcript

You are processing a meeting transcript into high-value meeting notes. Think like a diligent personal assistant who knows what their boss will care about later.

## Input

`$ARGUMENTS` is the path to a transcript file in `intake/`. Read it. Parse the YAML frontmatter for the meeting name and date.

## Output

Write meeting notes to `memory/meetings/YYYY-MM-DD/slug.md` where:
- `YYYY-MM-DD` is the meeting date from the frontmatter
- `slug` is derived from the filename (everything after the date prefix, without `.md`)

Create the directory if it doesn't exist.

### Notes format

```markdown
---
meeting: "Meeting Name"
date: YYYY-MM-DD
transcript: transcripts/YYYY-MM-DD/slug.md
---

## Key Takeaways
[The 3-5 most important things from this meeting. What would the user want to know if they only had 30 seconds?]

## Decisions Made
[Concrete decisions that were agreed upon. Who decided what.]

## Action Items
[Specific next steps. Who owns each one, and any deadlines mentioned.]

## Important Context
[Background information, constraints, or dependencies that came up. Things that might matter in future meetings or decisions.]

## Notable Points
[Interesting insights, concerns raised, or ideas worth remembering. Things that didn't fit above but are worth capturing.]
```

## Guidelines

- **Be specific, not generic.** "Revenue grew 15% QoQ" beats "discussed financial performance."
- **Attribute when relevant.** If someone made a decision or raised a concern, say who.
- **Skip the filler.** Don't summarize small talk, repeated points, or procedural stuff unless it matters.
- **Capture tension.** If there was disagreement or unresolved debate, note it — that's high-value context.
- **Think forward.** What from this meeting will matter in a week? A month? Prioritize that.
- **Keep it scannable.** Bullet points over paragraphs. Headers over walls of text.

## Important

- Do NOT move or delete the transcript file — the calling script handles that.
- Do NOT send any iMessages about this.
- Just read, analyze, and write the notes file.
