#!/usr/bin/env node

/**
 * Igloo iMessage Listener
 *
 * Runs continuously, watches for incoming iMessages via `imsg watch --json`,
 * debounces rapid messages, and invokes Claude to handle each conversation.
 *
 * This is separate from the heartbeat daemon — heartbeat handles scheduled
 * tasks (calendar, email, maintenance). This handles real-time chat.
 */

import { spawn } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IGLOO_DIR = resolve(__dirname, "..");
const LOG = resolve(IGLOO_DIR, "daemon/listener.log");
const MCP_CONFIG = resolve(IGLOO_DIR, "mcp/mcp-config.json");
const ALLOWED_SENDERS = resolve(IGLOO_DIR, ".claude/allowed-senders.json");

const DEBOUNCE_MS = 2000; // Batch messages within 2s window

// ── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.error(line);
  try {
    appendFileSync(LOG, line + "\n");
  } catch {}
}

// ── Allowed senders ─────────────────────────────────────────────────────────

function loadAllowedSenders() {
  try {
    if (existsSync(ALLOWED_SENDERS)) {
      return JSON.parse(readFileSync(ALLOWED_SENDERS, "utf8"));
    }
  } catch {}
  return null; // null = not configured, allow none until bootstrap
}

function isAllowed(sender) {
  const allowed = loadAllowedSenders();
  if (allowed === null) return false; // No config = block all (pre-bootstrap)
  if (allowed.length === 0) return true; // Empty array = allow all
  return allowed.some(
    (a) => sender.includes(a) || a.includes(sender)
  );
}

// ── Debounce buffer ─────────────────────────────────────────────────────────

const buffer = new Map(); // sender -> { messages: [], timer }
let dispatching = false;
const queue = []; // Queue dispatches to avoid parallel Claude invocations

function enqueue(sender, messages) {
  queue.push({ sender, messages });
  processQueue();
}

async function processQueue() {
  if (dispatching || queue.length === 0) return;
  dispatching = true;

  const { sender, messages } = queue.shift();
  try {
    await dispatch(sender, messages);
  } catch (e) {
    log(`ERROR dispatching: ${e.message}`);
  }

  dispatching = false;
  processQueue();
}

// ── Dispatch to Claude ──────────────────────────────────────────────────────

function dispatch(sender, messages) {
  return new Promise((resolve, reject) => {
    const text = messages.map((m) => m.text).filter(Boolean).join("\n");
    if (!text.trim()) {
      resolve();
      return;
    }

    const prompt = [
      `Incoming iMessage from ${sender}:`,
      `"${text}"`,
      "",
      'Follow the "Responding to Messages" instructions in CLAUDE.md.',
      "Read your memory files for context. Send your reply via the imsg MCP tool.",
      "Update your daily log with this interaction.",
    ].join("\n");

    log(`DISPATCH: ${sender} (${messages.length} msg) — ${text.slice(0, 80)}`);

    const claude = spawn(
      "claude",
      [
        "--print",
        "--permission-mode",
        "bypassPermissions",
        "--mcp-config",
        MCP_CONFIG,
        prompt,
      ],
      {
        cwd: IGLOO_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      }
    );

    let stdout = "";
    let stderr = "";
    claude.stdout.on("data", (d) => (stdout += d));
    claude.stderr.on("data", (d) => (stderr += d));

    claude.on("close", (code) => {
      if (code !== 0) {
        log(`CLAUDE EXIT ${code}: ${stderr.slice(0, 200)}`);
      } else {
        log(`CLAUDE OK: responded to ${sender}`);
      }
      resolve();
    });

    claude.on("error", (err) => {
      log(`CLAUDE SPAWN ERROR: ${err.message}`);
      reject(err);
    });

    // Safety timeout: kill after 5 minutes
    setTimeout(() => {
      claude.kill("SIGTERM");
      log(`CLAUDE TIMEOUT: killed after 5m for ${sender}`);
      resolve();
    }, 5 * 60 * 1000);
  });
}

// ── Watch for messages ──────────────────────────────────────────────────────

function startWatcher() {
  log("LISTENER START — watching for iMessages");

  const watcher = spawn("imsg", ["watch", "--json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let partial = "";

  watcher.stdout.on("data", (chunk) => {
    partial += chunk.toString();
    const lines = partial.split("\n");
    partial = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Skip our own messages
        if (msg.is_from_me) continue;

        const sender = msg.sender || msg.handle || msg.participants?.[0] || "unknown";
        const text = msg.text || "";

        if (!text) continue;
        if (!isAllowed(sender)) {
          log(`BLOCKED: ${sender} (not in allowed senders)`);
          continue;
        }

        // Debounce: batch rapid messages from same sender
        if (buffer.has(sender)) {
          const entry = buffer.get(sender);
          clearTimeout(entry.timer);
          entry.messages.push({ text, raw: msg });
          entry.timer = setTimeout(() => {
            const msgs = buffer.get(sender).messages;
            buffer.delete(sender);
            enqueue(sender, msgs);
          }, DEBOUNCE_MS);
        } else {
          buffer.set(sender, {
            messages: [{ text, raw: msg }],
            timer: setTimeout(() => {
              const msgs = buffer.get(sender).messages;
              buffer.delete(sender);
              enqueue(sender, msgs);
            }, DEBOUNCE_MS),
          });
        }
      } catch (e) {
        log(`PARSE ERROR: ${e.message} — ${line.slice(0, 100)}`);
      }
    }
  });

  watcher.stderr.on("data", (d) => log(`IMSG STDERR: ${d}`));

  watcher.on("close", (code) => {
    log(`IMSG WATCH EXITED (${code}) — restarting in 5s`);
    setTimeout(() => startWatcher(), 5000);
  });

  watcher.on("error", (err) => {
    log(`IMSG WATCH ERROR: ${err.message} — retrying in 10s`);
    setTimeout(() => startWatcher(), 10000);
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  log("LISTENER STOP (SIGTERM)");
  process.exit(0);
});

process.on("SIGINT", () => {
  log("LISTENER STOP (SIGINT)");
  process.exit(0);
});

startWatcher();
