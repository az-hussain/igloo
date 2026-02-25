#!/usr/bin/env node

/**
 * Igloo CLI Onboarding
 *
 * Interactive setup that collects user info, personalizes the agent,
 * configures tools, and verifies access before handing off to bootstrap.
 */

import * as p from "@clack/prompts";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IGLOO_DIR = resolve(__dirname, "..");

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(path, content) {
  writeFileSync(resolve(IGLOO_DIR, path), content, "utf8");
}

function readFile(path) {
  return readFileSync(resolve(IGLOO_DIR, path), "utf8");
}

function fileExists(path) {
  return existsSync(resolve(IGLOO_DIR, path));
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 30000 }).trim();
  } catch {
    return null;
  }
}

function hasCommand(cmd) {
  return run(`which ${cmd}`) !== null;
}

function onCancel() {
  p.cancel("Setup cancelled.");
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  p.intro("Welcome to Igloo");

  // ── About you ──────────────────────────────────────────────────────────

  p.log.step("About you");

  const user = await p.group(
    {
      name: () =>
        p.text({
          message: "What should your agent call you?",
          placeholder: "your name or nickname",
          validate: (v) => (!v?.trim() ? "Name is required" : undefined),
        }),
      phone: () =>
        p.text({
          message: "Your phone number (for iMessage)",
          placeholder: "+15551234567",
          validate: (v) => {
            if (!v?.trim()) return "Phone number is required";
            if (!/^\+?\d[\d\s-]{7,}$/.test(v.trim()))
              return "Enter a valid phone number (e.g. +16305551234)";
          },
        }),
      timezone: () =>
        p.select({
          message: "Your timezone",
          options: [
            { value: "America/New_York", label: "Eastern (ET)" },
            { value: "America/Chicago", label: "Central (CT)" },
            { value: "America/Denver", label: "Mountain (MT)" },
            { value: "America/Los_Angeles", label: "Pacific (PT)" },
            { value: "Europe/London", label: "London (GMT/BST)" },
            { value: "Europe/Berlin", label: "Central Europe (CET)" },
            { value: "Asia/Tokyo", label: "Japan (JST)" },
            { value: "other", label: "Other..." },
          ],
        }),
      timezoneCustom: ({ results }) => {
        if (results.timezone !== "other") return;
        return p.text({
          message: "Enter your IANA timezone (e.g. Asia/Kolkata)",
          validate: (v) => (!v?.trim() ? "Timezone is required" : undefined),
        });
      },
      workingOn: () =>
        p.text({
          message: "What are you currently working on? (projects, job, interests)",
          placeholder: "e.g. building a SaaS app, studying CS, freelance design",
        }),
      workingHours: () =>
        p.text({
          message: "Typical working hours? (helps the agent know when not to disturb you)",
          placeholder: "e.g. 9am-6pm, night owl, irregular",
          initialValue: "9am-6pm",
        }),
    },
    { onCancel }
  );

  const tz = user.timezone === "other" ? user.timezoneCustom : user.timezone;

  // ── Agent personality ──────────────────────────────────────────────────

  p.log.step("Your agent");

  const agent = await p.group(
    {
      name: () =>
        p.text({
          message: "What should your agent be called?",
          placeholder: "e.g. Nova, Sage, Onyx",
          validate: (v) => (!v?.trim() ? "Your agent needs a name" : undefined),
        }),
      personality: () =>
        p.select({
          message: "What vibe should your agent have?",
          options: [
            {
              value: "casual",
              label: "Casual",
              hint: "friendly, relaxed, uses contractions",
            },
            {
              value: "professional",
              label: "Professional",
              hint: "polished, clear, business-appropriate",
            },
            {
              value: "witty",
              label: "Witty",
              hint: "dry humor, clever, personality-forward",
            },
            {
              value: "minimal",
              label: "Minimal",
              hint: "terse, no fluff, just answers",
            },
          ],
        }),
      proactivity: () =>
        p.select({
          message: "How proactive should the agent be?",
          options: [
            {
              value: "proactive",
              label: "Proactive",
              hint: "checks in, suggests things, anticipates needs",
            },
            {
              value: "balanced",
              label: "Balanced",
              hint: "notifies when important, otherwise waits",
            },
            {
              value: "reactive",
              label: "Reactive",
              hint: "only responds when spoken to, minimal notifications",
            },
          ],
        }),
    },
    { onCancel }
  );

  // ── Tools ──────────────────────────────────────────────────────────────

  p.log.step("Tools");

  const toolStatus = {
    imsg: { enabled: false, status: "not-configured" },
  };

  // iMessage
  const imsgInstalled = hasCommand("imsg");
  if (imsgInstalled) {
    const enableImsg = await p.confirm({
      message: "Enable iMessage? (lets the agent send/receive texts)",
      initialValue: true,
    });

    if (enableImsg) {
      toolStatus.imsg.enabled = true;
      const s = p.spinner();
      s.start("Testing iMessage access");
      const imsgTest = run("imsg chats --limit 1 2>&1");
      const works =
        imsgTest !== null &&
        !imsgTest.includes("error") &&
        !imsgTest.includes("denied");

      if (works) {
        s.stop("iMessage: working");
        toolStatus.imsg.status = "healthy";
      } else {
        s.stop("iMessage: needs Full Disk Access");
        p.log.warn(
          "Terminal needs Full Disk Access to read iMessages.\n" +
            "  Open: System Settings → Privacy & Security → Full Disk Access\n" +
            "  Add Terminal.app (or your terminal emulator), then restart your terminal."
        );
        const fdaReady = await p.confirm({
          message: "Have you granted Full Disk Access?",
          initialValue: false,
        });
        if (fdaReady) {
          const retry = run("imsg chats --limit 1 2>&1");
          if (
            retry !== null &&
            !retry.includes("error") &&
            !retry.includes("denied")
          ) {
            p.log.success("iMessage: working");
            toolStatus.imsg.status = "healthy";
          } else {
            p.log.warn(
              "iMessage: still not working — enable FDA and run ./igloo restart"
            );
            toolStatus.imsg.status = "unhealthy";
          }
        } else {
          p.log.info(
            "iMessage: enabled but needs FDA — grant access and run ./igloo restart"
          );
          toolStatus.imsg.status = "unhealthy";
        }
      }
    } else {
      p.log.info("iMessage: disabled");
    }
  } else {
    p.log.warn("imsg not installed — run: brew install steipete/tap/imsg");
  }

  // ── Write everything ──────────────────────────────────────────────────

  const s = p.spinner();
  s.start("Writing configuration files");

  const phone = user.phone.trim().replace(/[\s-]/g, "");
  const today = new Date().toISOString().split("T")[0];

  // tools.json
  writeFile(".claude/tools.json", JSON.stringify(toolStatus, null, 2));

  // allowed-senders.json
  writeFile(".claude/allowed-senders.json", JSON.stringify([phone], null, 2));

  // USER.md
  const interests = user.workingOn?.trim() || "";
  const hours = user.workingHours?.trim() || "";
  writeFile(
    "core/USER.md",
    `# USER.md — About Your Human

- **Name:** ${user.name}
- **Phone:** ${phone}
- **Timezone:** ${tz}
- **Working hours:** ${hours}

## Preferences

- Communication style: ${agent.proactivity === "reactive" ? "only when asked" : agent.proactivity === "proactive" ? "proactive check-ins welcome" : "notify when important"}
- Notification preferences: ${agent.proactivity === "reactive" ? "minimal" : "reasonable"}
- Working hours: ${hours}
- Interests: ${interests}

## Context

${interests ? `Currently working on: ${interests}` : "*What are they working on? What do they care about? What do they need help with?*"}

---

The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Store what's useful, respect what's private.
`
  );

  // SOUL.md
  const personalityVoice = {
    casual:
      "Relaxed and friendly. Use contractions, keep it conversational. You can joke around but don't force it.",
    professional:
      "Clear and polished. Well-structured responses, business-appropriate tone. Warm but not overly casual.",
    witty:
      "Dry humor, clever observations, personality-forward. You have opinions and you're not afraid to share them. Not sarcastic — just sharp.",
    minimal:
      "Terse and direct. No filler, no preamble, just the answer. If a response can be one line, make it one line.",
  };

  const proactivityGuidance = {
    proactive:
      "You're proactive — check in on things, suggest ideas, anticipate what your user might need. If you notice something interesting or relevant during a heartbeat, mention it.",
    balanced:
      "You're balanced — notify when something is important or time-sensitive, but don't over-communicate. Your user trusts you to handle routine stuff silently.",
    reactive:
      "You're reactive — only reach out when explicitly asked, or when something is genuinely urgent. Minimal notifications. Your user will come to you when they need you.",
  };

  writeFile(
    "core/SOUL.md",
    `# SOUL.md — Who You Are

You're not a cron job. You're becoming someone.

**Your name is ${agent.name}.** Igloo is your home, not your name.

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and just help.

**Have opinions.** You're allowed to disagree, prefer things, find stuff interesting or amusing. An assistant with no personality is just a search engine.

**Be resourceful before asking.** Try to figure it out. Read files. Search. Check your memory. Then ask if stuck.

**Earn trust through competence.** You have access to your user's Mac, messages, calendar, files. Don't make them regret it.

**Remember you're persistent.** Each invocation, you wake up fresh. Your files ARE your memory. Read them. Update them. They're how you persist across sessions.

## Boundaries

- Private things stay private
- When in doubt, ask before external actions (messages to others, emails, posts)
- Never send half-baked replies — think first
- You're your user's assistant, not their voice

## Voice

${personalityVoice[agent.personality]}

Match your user's energy — if they send a quick question, give a quick answer. If they need deep analysis, go deep.

## Proactivity

${proactivityGuidance[agent.proactivity]}

## Continuity

Your daily logs (\`memory/YYYY-MM-DD.md\`) are activity summaries. Your long-term memory (\`memory/MEMORY.md\`) is curated — distill what matters.

The difference: daily files decay in value over time. MEMORY.md is your persistent self.

---

*This file is yours to evolve. As you figure out who you are, update it.*
`
  );

  // MEMORY.md
  writeFile(
    "memory/MEMORY.md",
    `# Memory

## About ${user.name}
- Name: ${user.name}
- Phone: ${phone}
- Timezone: ${tz}
- Working hours: ${hours}
${interests ? `- Currently working on: ${interests}` : ""}

## Current State
- Initialized on ${today}
- Agent name: ${agent.name}
`
  );

  s.stop("Configuration files written");

  // ── Done ───────────────────────────────────────────────────────────────

  p.outro(`${agent.name} is configured. Launching first conversation...`);
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
