#!/usr/bin/env node

/**
 * Igloo Meeting — Transcript intake
 *
 * Prompts for a meeting name, creates a file with YAML frontmatter,
 * opens the user's editor, and outputs the file path for processing.
 */

import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";

const IGLOO_HOME =
  process.env.IGLOO_HOME || resolve(process.env.HOME, ".igloo");
const RESULT_FILE = resolve(IGLOO_HOME, "intake", ".last-meeting.json");

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function onCancel() {
  p.cancel("Cancelled.");
  process.exit(1);
}

async function main() {
  p.intro("New Meeting");

  const name = await p.text({
    message: "Meeting name",
    placeholder: "e.g. Weekly standup, Client call with Acme",
    validate: (v) => (!v?.trim() ? "Meeting name is required" : undefined),
  });

  if (p.isCancel(name)) onCancel();

  const slug = slugify(name);
  const date = new Date().toISOString().split("T")[0];
  const filename = `${date}-${slug}.md`;

  const intakeDir = resolve(IGLOO_HOME, "intake");
  mkdirSync(intakeDir, { recursive: true });

  const filepath = resolve(intakeDir, filename);

  const frontmatter = `---
type: meeting-transcript
meeting: "${name}"
date: ${date}
---

`;

  writeFileSync(filepath, frontmatter, "utf8");

  const editor = process.env.EDITOR || "nano";
  p.log.step(`Opening ${editor}...`);

  try {
    execSync(`${editor} "${filepath}"`, { stdio: "inherit" });
  } catch {
    p.cancel("Editor closed with error.");
    try { unlinkSync(filepath); } catch {}
    process.exit(1);
  }

  // Check if content was added beyond the frontmatter
  const content = readFileSync(filepath, "utf8");
  if (content.trim() === frontmatter.trim()) {
    p.cancel("No content added — transcript discarded.");
    try { unlinkSync(filepath); } catch {}
    process.exit(1);
  }

  // Write result for the calling script
  writeFileSync(
    RESULT_FILE,
    JSON.stringify({ filepath, slug, date, filename }),
    "utf8"
  );

  p.outro("Transcript saved.");
}

main().catch((err) => {
  console.error("Meeting failed:", err.message);
  process.exit(1);
});
