#!/usr/bin/env node

/**
 * Igloo Listener + Scheduler
 *
 * Single daemon that handles both:
 * 1. Real-time iMessages via `imsg rpc` JSON-RPC (watch.subscribe)
 * 2. Cron-based scheduled tasks via croner (core/schedules.json)
 *
 * Both flow through the same serial queue and persistent Claude session,
 * so scheduled tasks can interact with the user via iMessage if needed.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { watch as fsWatch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { Cron } from "croner";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_DIR = process.env.CODE_DIR || resolve(__dirname, "..");
const IGLOO_HOME = process.env.IGLOO_HOME || CODE_DIR;
const ALLOWED_SENDERS = resolve(IGLOO_HOME, ".claude/allowed-senders.json");
const SESSION_ID_FILE = resolve(IGLOO_HOME, ".claude/session-id");
const SCHEDULES_FILE = resolve(IGLOO_HOME, "core/schedules.json");
const SCHEDULE_STATE_FILE = resolve(IGLOO_HOME, ".claude/scheduler-state.json");

const DEBOUNCE_MS = 2000; // Batch messages within 2s window
const RECONNECT_DELAY_MS = 5000; // Wait before reconnecting on failure
const RPC_TIMEOUT_MS = 10000; // Timeout for RPC requests

// ── Env for spawning Claude ──────────────────────────────────────────────────

function cleanEnv() {
  const env = { ...process.env };
  // Remove Claude Code session markers so spawned claude doesn't think it's nested
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

// ── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  // Output goes to daemon/listener.log via nohup redirect
  console.error(`${new Date().toISOString()} ${msg}`);
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

// ── Session management ──────────────────────────────────────────────────────

function buildContext() {
  let context = "";
  const files = [
    resolve(IGLOO_HOME, "core/SOUL.md"),
    resolve(IGLOO_HOME, "core/USER.md"),
    resolve(IGLOO_HOME, "memory/MEMORY.md"),
  ];
  for (const f of files) {
    try {
      context += readFileSync(f, "utf8") + "\n\n";
    } catch {}
  }
  if (context) {
    return `[Context]\n${context}[End Context]\n\n`;
  }
  return "";
}

/**
 * Get existing session ID, or create a new one if none exists.
 * Returns { id, isNew } — isNew means the session needs to be created (use --session-id).
 * Existing sessions should be resumed (use --resume).
 */
function getOrCreateSessionId() {
  try {
    const id = readFileSync(SESSION_ID_FILE, "utf8").trim();
    if (id) return { id, isNew: false };
  } catch {}
  const id = crypto.randomUUID();
  writeFileSync(SESSION_ID_FILE, id);
  return { id, isNew: true };
}

// ── Serial queue (messages + scheduled tasks) ───────────────────────────────

const buffer = new Map(); // sender -> { messages: [], timer }
let dispatching = false;
const queue = [];

function enqueueMessage(sender, messages) {
  queue.push({ kind: "message", sender, messages });
  processQueue();
}

function enqueueSchedule(schedule) {
  if (queue.some((q) => q.kind === "schedule" && q.schedule.id === schedule.id)) {
    log(`SKIP [${schedule.id}]: already queued`);
    return;
  }
  queue.push({ kind: "schedule", schedule });
  processQueue();
}

async function processQueue() {
  if (dispatching || queue.length === 0) return;
  dispatching = true;

  const item = queue.shift();
  try {
    if (item.kind === "message") {
      await dispatch(item.sender, item.messages);
    } else {
      await dispatchSchedule(item.schedule);
    }
  } catch (e) {
    log(`ERROR: ${e.message}`);
  }

  dispatching = false;
  processQueue();
}

// ── Dispatch to Claude ──────────────────────────────────────────────────────

function dispatch(sender, messages) {
  return new Promise((resolvePromise, reject) => {
    const text = messages.map((m) => m.text).filter(Boolean).join("\n");
    if (!text.trim()) {
      resolvePromise();
      return;
    }

    const prompt = [
      `Incoming iMessage from ${sender}:`,
      `"${text}"`,
      "",
      'Follow the "Responding to Messages" instructions in CLAUDE.md.',
      "Read your memory files for context. Send your reply via the imsg MCP tool.",
    ].join("\n");

    log(`DISPATCH: ${sender} (${messages.length} msg) — ${text.slice(0, 80)}`);

    const args = ["--print", "--chrome"];

    const { id: sid, isNew } = getOrCreateSessionId();
    let fullPrompt = prompt;
    if (isNew) {
      // First dispatch for this session — create it, inject context
      args.push("--session-id", sid);
      fullPrompt = buildContext() + prompt;
    } else {
      args.push("--resume", sid);
    }

    args.push(fullPrompt);
    log(`SPAWN: claude ${isNew ? "--session-id" : "--resume"} ${sid}`);

    const claude = spawn("claude", args, {
      cwd: IGLOO_HOME,
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnv(),
    });

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
      resolvePromise();
    });

    claude.on("error", (err) => {
      log(`CLAUDE SPAWN ERROR: ${err.message}`);
      reject(err);
    });

    // Safety timeout: kill after 5 minutes
    setTimeout(() => {
      claude.kill("SIGTERM");
      log(`CLAUDE TIMEOUT: killed after 5m for ${sender}`);
      resolvePromise();
    }, 5 * 60 * 1000);
  });
}

// ── Dispatch scheduled task to Claude ────────────────────────────────────────

function dispatchSchedule(schedule) {
  return new Promise((resolvePromise) => {
    const prompt = [
      `SCHEDULED [${schedule.id}]: ${schedule.name}`,
      "",
      schedule.prompt,
      "",
      "Follow the behavioral guidelines in core/HEARTBEAT.md.",
      "Your final output line MUST be: HEARTBEAT_OK: <summary> or HEARTBEAT_ERR: <error>",
      "Read memory/MEMORY.md for context.",
    ].join("\n");

    log(`SCHEDULE [${schedule.id}]: ${schedule.name}`);

    const args = ["--print", "--chrome"];
    const { id: sid, isNew } = getOrCreateSessionId();
    if (isNew) {
      args.push("--session-id", sid);
    } else {
      args.push("--resume", sid);
    }
    args.push(prompt);

    const startMs = Date.now();
    const claude = spawn("claude", args, {
      cwd: IGLOO_HOME,
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnv(),
    });

    let stdout = "",
      stderr = "";
    claude.stdout.on("data", (d) => (stdout += d));
    claude.stderr.on("data", (d) => (stderr += d));

    claude.on("close", (code) => {
      const durationMs = Date.now() - startMs;
      const statusLine = stdout
        .split("\n")
        .reverse()
        .find((l) => /^HEARTBEAT_(OK|ERR):/.test(l));

      if (statusLine) {
        const ok = statusLine.startsWith("HEARTBEAT_OK");
        log(
          `SCHEDULE ${ok ? "OK" : "ERR"} [${schedule.id}]: ${statusLine.replace(/^HEARTBEAT_(OK|ERR):\s*/, "")}`
        );
      } else if (code !== 0) {
        log(
          `SCHEDULE FAIL [${schedule.id}]: exit ${code} — ${stderr.slice(0, 200)}`
        );
      } else {
        log(`SCHEDULE OK [${schedule.id}]: completed (${durationMs}ms)`);
      }

      updateScheduleState(schedule.id, {
        lastRunAtMs: startMs,
        lastDurationMs: durationMs,
        lastStatus: code === 0 ? "ok" : "error",
      });
      resolvePromise();
    });

    claude.on("error", (err) => {
      log(`SCHEDULE SPAWN ERROR [${schedule.id}]: ${err.message}`);
      resolvePromise();
    });

    // Safety timeout: 10 min
    setTimeout(() => {
      claude.kill("SIGTERM");
      log(`SCHEDULE TIMEOUT [${schedule.id}]: killed after 10m`);
      resolvePromise();
    }, 10 * 60 * 1000);
  });
}

// ── Schedule loading + state management ─────────────────────────────────────

function loadSchedules() {
  try {
    return JSON.parse(readFileSync(SCHEDULES_FILE, "utf8")).filter(
      (s) => s.enabled
    );
  } catch {
    return [];
  }
}

function loadScheduleState() {
  try {
    return JSON.parse(readFileSync(SCHEDULE_STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function updateScheduleState(id, update) {
  const state = loadScheduleState();
  state[id] = { ...state[id], ...update };
  writeFileSync(SCHEDULE_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Cron setup + hot-reload ─────────────────────────────────────────────────

let activeCrons = [];

function setupCrons() {
  for (const c of activeCrons) c.stop();
  activeCrons = [];

  const schedules = loadSchedules();

  for (const schedule of schedules) {
    try {
      const job = new Cron(schedule.cron, () => {
        enqueueSchedule(schedule);
      });
      activeCrons.push(job);
      const next = job.nextRun();
      log(
        `CRON [${schedule.id}]: "${schedule.cron}" — next: ${next?.toISOString() || "never"}`
      );
    } catch (e) {
      log(`CRON ERROR [${schedule.id}]: ${e.message}`);
    }
  }
  return activeCrons;
}

function watchSchedules() {
  let debounce = null;
  fsWatch(SCHEDULES_FILE, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      log("RELOAD: schedules.json changed");
      setupCrons();
    }, 500);
  });
}

// ── Tool config helper ──────────────────────────────────────────────────────

function toolEnabled(name) {
  try {
    const tools = JSON.parse(
      readFileSync(resolve(IGLOO_HOME, ".claude/tools.json"), "utf8")
    );
    return tools[name]?.enabled === true;
  } catch {
    return false;
  }
}

// ── Handle incoming message notification ────────────────────────────────────

function handleMessage(params) {
  const message = params?.message;
  if (!message) return;

  // Skip our own messages
  if (message.is_from_me) return;

  const sender =
    message.sender ||
    message.chat_identifier ||
    message.participants?.[0] ||
    "unknown";
  const text = message.text || "";

  if (!text) return;
  if (!isAllowed(sender)) {
    log(`BLOCKED: ${sender} (not in allowed senders)`);
    return;
  }

  // Handle /new command — reset session
  if (text.trim() === "/new") {
    try { unlinkSync(SESSION_ID_FILE); } catch {}
    log("NEW SESSION: reset by user command");
    spawn("imsg", ["send", "--to", sender, "--text", "Session reset. Next message starts fresh."]);
    return;
  }

  // Debounce: batch rapid messages from same sender
  if (buffer.has(sender)) {
    const entry = buffer.get(sender);
    clearTimeout(entry.timer);
    entry.messages.push({ text, raw: message });
    entry.timer = setTimeout(() => {
      const msgs = buffer.get(sender).messages;
      buffer.delete(sender);
      enqueueMessage(sender, msgs);
    }, DEBOUNCE_MS);
  } else {
    buffer.set(sender, {
      messages: [{ text, raw: message }],
      timer: setTimeout(() => {
        const msgs = buffer.get(sender).messages;
        buffer.delete(sender);
        enqueueMessage(sender, msgs);
      }, DEBOUNCE_MS),
    });
  }
}

// ── iMessage RPC Client ─────────────────────────────────────────────────────

class ImsgRpcClient {
  constructor() {
    this.child = null;
    this.reader = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  async start() {
    if (this.child) return;

    const child = spawn("imsg", ["rpc"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = child;
    this.reader = createInterface({ input: child.stdout });

    this.reader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleLine(trimmed);
    });

    child.stderr?.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const l of lines) {
        if (l.trim()) log(`IMSG RPC STDERR: ${l.trim()}`);
      }
    });

    child.on("error", (err) => {
      log(`IMSG RPC ERROR: ${err.message}`);
      this.failAll(err);
    });

    child.on("close", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      log(`IMSG RPC CLOSED: ${reason}`);
      this.failAll(new Error(`imsg rpc exited (${reason})`));
    });
  }

  handleLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      log(`IMSG RPC PARSE ERROR: ${err.message} — ${line.slice(0, 100)}`);
      return;
    }

    // Response to a request (has id)
    if (parsed.id !== undefined && parsed.id !== null) {
      const key = String(parsed.id);
      const pending = this.pending.get(key);
      if (!pending) return;

      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(key);

      if (parsed.error) {
        const msg = parsed.error.message || "imsg rpc error";
        pending.reject(new Error(msg));
        return;
      }

      pending.resolve(parsed.result);
      return;
    }

    // Notification (no id) — e.g. { method: "message", params: {...} }
    if (parsed.method) {
      if (parsed.method === "message") {
        handleMessage(parsed.params);
      } else if (parsed.method === "error") {
        log(`IMSG RPC WATCH ERROR: ${JSON.stringify(parsed.params)}`);
      }
    }
  }

  async request(method, params = {}) {
    if (!this.child || !this.child.stdin) {
      throw new Error("imsg rpc not running");
    }

    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const key = String(id);
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`imsg rpc timeout (${method})`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(key, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  failAll(err) {
    for (const [key, pending] of this.pending.entries()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(key);
    }
  }

  async stop() {
    if (!this.child) return;
    this.reader?.close();
    this.reader = null;
    this.child.stdin?.end();
    const child = this.child;
    this.child = null;

    // Give it 500ms to exit gracefully, then force kill
    await Promise.race([
      new Promise((resolve) => child.on("close", resolve)),
      new Promise((resolve) => {
        setTimeout(() => {
          if (!child.killed) child.kill("SIGTERM");
          resolve();
        }, 500);
      }),
    ]);
  }
}

// ── iMessage loop with auto-reconnect ────────────────────────────────────────

async function runImsg() {
  log("IMSG: connecting to imsg rpc");

  const client = new ImsgRpcClient();

  try {
    await client.start();

    const result = await client.request("watch.subscribe", {
      attachments: false,
    });
    const subscriptionId = result?.subscription ?? null;
    log(`SUBSCRIBED: watch.subscribe (subscription=${subscriptionId})`);

    await new Promise((resolve) => {
      client.child?.on("close", resolve);
    });
  } catch (err) {
    log(`RPC ERROR: ${err.message}`);
  } finally {
    await client.stop();
  }

  log(`IMSG RECONNECTING in ${RECONNECT_DELAY_MS / 1000}s...`);
  setTimeout(runImsg, RECONNECT_DELAY_MS);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  log("LISTENER START");

  // Always start scheduler
  setupCrons();
  watchSchedules();

  // Only start iMessage if enabled
  if (toolEnabled("imsg")) {
    runImsg();
  } else {
    log("iMessage disabled — scheduler-only mode");
    // croner timers keep the process alive
  }
}

// ── Signal handlers ─────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  log("LISTENER STOP (SIGTERM)");
  process.exit(0);
});

process.on("SIGINT", () => {
  log("LISTENER STOP (SIGINT)");
  process.exit(0);
});

run();
