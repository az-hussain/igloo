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
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { watch as fsWatch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { Cron } from "croner";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_DIR = process.env.CODE_DIR || resolve(__dirname, "..");
const IGLOO_HOME = process.env.IGLOO_HOME || CODE_DIR;
const ALLOWED_SENDERS = resolve(IGLOO_HOME, ".claude/allowed-senders.json");
const LEGACY_SESSION_FILE = resolve(IGLOO_HOME, ".claude/session-id");
const SESSIONS_DIR = resolve(IGLOO_HOME, ".claude/sessions");
const PRINCIPALS_FILE = resolve(IGLOO_HOME, ".claude/principals.json");
const SCHEDULES_FILE = resolve(IGLOO_HOME, "core/schedules.json");
const SCHEDULE_STATE_FILE = resolve(IGLOO_HOME, ".claude/scheduler-state.json");

const MODEL = process.env.IGLOO_MODEL || "opus"; // resumed sessions keep their original model unless overridden

const DEBOUNCE_MS = 2000; // Batch messages within 2s window
const RECONNECT_DELAY_MS = 5000; // Wait before reconnecting on failure
const RPC_TIMEOUT_MS = 10000; // Timeout for RPC requests
const MESSAGE_TIMEOUT_MINUTES = Number(process.env.IGLOO_MESSAGE_TIMEOUT_MINUTES) || 15; // 1:1/group dispatch safety timeout
const MAX_CONCURRENT = Number(process.env.IGLOO_MAX_CONCURRENT) || 2; // concurrent claude turns across different sessions
const DISPATCH_STATE_FILE = resolve(IGLOO_HOME, ".claude/dispatch-state.json");
const CHAT_DB = resolve(process.env.HOME, "Library/Messages/chat.db");

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
 * Sessions are per-principal (and per-group), not global. Each principal's
 * 1:1 thread and their own scheduled routines share one session — so routines
 * can converse — but principals never share a context window with each other,
 * and group chats never see any principal's 1:1 context. Shared knowledge
 * lives in memory files, not the session. See CLAUDE.md "Trust Model".
 *
 * .claude/principals.json maps handles to principal names:
 *   { "+1...": "azhar", "+1...": "hira" }
 * Schedules declare "owner" (default "azhar") and run in that session.
 */
function principalFor(sender) {
  try {
    return JSON.parse(readFileSync(PRINCIPALS_FILE, "utf8"))[sender] || null;
  } catch {
    return null;
  }
}

function sessionKeyFor(meta) {
  if (meta.isGroup) return `group-${meta.chatId}`;
  const p = principalFor(meta.sender);
  if (p) return p;
  return `sender-${String(meta.sender).replace(/[^A-Za-z0-9@.+-]/g, "_")}`;
}

function sessionFile(key) {
  return resolve(SESSIONS_DIR, `${key}.session-id`);
}

/**
 * Get existing session ID for a key, or create a new one.
 * Returns { id, isNew } — isNew means create with --session-id, else --resume.
 */
function getOrCreateSession(key) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  // Migration: the pre-split global session belongs to the primary principal,
  // preserving continuity. The legacy file is left in place because the
  // `igloo` interactive chat still reads it.
  if (key === "azhar" && !existsSync(sessionFile(key)) && existsSync(LEGACY_SESSION_FILE)) {
    writeFileSync(sessionFile(key), readFileSync(LEGACY_SESSION_FILE, "utf8").trim());
  }
  try {
    const id = readFileSync(sessionFile(key), "utf8").trim();
    if (id) return { id, isNew: false };
  } catch {}
  const id = crypto.randomUUID();
  writeFileSync(sessionFile(key), id);
  return { id, isNew: true };
}

// ── Dispatch lanes: per-session concurrency + durable queue ─────────────────
//
// Turns in the SAME session run strictly in order (conversations must be
// sequential); turns in DIFFERENT sessions run concurrently, capped at
// MAX_CONCURRENT. Shared memory files and git are the cross-lane hazard —
// the cap stays low and CLAUDE.md documents concurrent-write etiquette.
//
// Durability: queued items and a high-water mark (highest chat.db message
// ROWID seen) persist to DISPATCH_STATE_FILE. On SIGTERM the debounce
// buffers flush into lanes before the state is saved, so clean restarts drop
// nothing. On startup, pending items reload and a catch-up scan of chat.db
// replays anything that arrived while the daemon was down. A turn already
// running at restart is NOT replayed — launchd abandons the process group,
// so in-flight turns survive restarts and complete on their own.

const buffer = new Map(); // bufferKey -> { messages: [], timer, meta }
const lanes = new Map(); // laneKey -> { queue: [], running: false }
let activeCount = 0;
let hwmRowid = 0;
let stateLoaded = false;
const seenRowids = new Set(); // recent message ids — dedup between live watch and catch-up

function laneFor(key) {
  if (!lanes.has(key)) lanes.set(key, { queue: [], running: false });
  return lanes.get(key);
}

function markSeen(rowid) {
  if (!rowid) return false;
  if (seenRowids.has(rowid)) return true;
  seenRowids.add(rowid);
  if (seenRowids.size > 1000) {
    for (const r of seenRowids) {
      seenRowids.delete(r);
      if (seenRowids.size <= 500) break;
    }
  }
  if (rowid > hwmRowid) {
    hwmRowid = rowid;
    saveDispatchState();
  }
  return false;
}

function loadDispatchState() {
  try {
    const s = JSON.parse(readFileSync(DISPATCH_STATE_FILE, "utf8"));
    hwmRowid = s.hwmRowid || 0;
    stateLoaded = true;
    return Array.isArray(s.pending) ? s.pending : [];
  } catch {
    return []; // first run under this feature — catchUpScan will init the HWM
  }
}

function saveDispatchState() {
  const pending = [];
  for (const [laneKey, ln] of lanes) {
    for (const item of ln.queue) {
      if (item.kind === "message") {
        pending.push({
          laneKey,
          kind: "message",
          meta: item.meta,
          messages: item.messages.map((m) => ({ text: m.text })),
        });
      } else {
        pending.push({ laneKey, kind: "schedule", scheduleId: item.schedule.id });
      }
    }
  }
  try {
    writeFileSync(DISPATCH_STATE_FILE, JSON.stringify({ hwmRowid, pending }, null, 2));
  } catch (e) {
    log(`STATE WRITE ERROR: ${e.message}`);
  }
}

function restorePending(pending) {
  let restored = 0;
  for (const p of pending) {
    if (p.kind === "message" && p.meta && Array.isArray(p.messages)) {
      laneFor(p.laneKey).queue.push({ kind: "message", meta: p.meta, messages: p.messages });
      restored++;
    } else if (p.kind === "schedule" && p.scheduleId) {
      const schedule = currentSchedules.find((s) => s.id === p.scheduleId);
      if (schedule) {
        laneFor(p.laneKey).queue.push({ kind: "schedule", schedule });
        restored++;
      }
    }
  }
  if (restored) {
    log(`RESTORED: ${restored} pending item(s) from previous run`);
    pump();
  }
}

function enqueueMessage(meta, messages) {
  const laneKey = sessionKeyFor(meta);
  laneFor(laneKey).queue.push({ kind: "message", meta, messages });
  saveDispatchState();
  pump();
}

function enqueueSchedule(schedule) {
  const laneKey = schedule.owner || "azhar";
  const ln = laneFor(laneKey);
  if (ln.queue.some((q) => q.kind === "schedule" && q.schedule.id === schedule.id)) {
    log(`SKIP [${schedule.id}]: already queued`);
    return;
  }
  ln.queue.push({ kind: "schedule", schedule });
  saveDispatchState();
  pump();
}

function pump() {
  for (const [laneKey, ln] of lanes) {
    if (activeCount >= MAX_CONCURRENT) return;
    if (ln.running || ln.queue.length === 0) continue;
    const item = ln.queue.shift();
    ln.running = true;
    activeCount++;
    saveDispatchState();
    (async () => {
      try {
        if (item.kind === "message") {
          await dispatch(item.meta, item.messages);
        } else {
          await dispatchSchedule(item.schedule);
        }
      } catch (e) {
        log(`ERROR [lane=${laneKey}]: ${e.message}`);
      }
      ln.running = false;
      activeCount--;
      pump();
    })();
  }
}

// ── Dispatch to Claude ──────────────────────────────────────────────────────

function dispatch(meta, messages) {
  return new Promise((resolvePromise, reject) => {
    const { sender, isGroup, chatId } = meta;
    const text = messages.map((m) => m.text).filter(Boolean).join("\n");
    if (!text.trim()) {
      resolvePromise();
      return;
    }

    const prompt = [
      isGroup
        ? `Incoming iMessage in GROUP chat (chat_id=${chatId}), sent by ${sender}:`
        : `Incoming iMessage from ${sender}:`,
      `"${text}"`,
      "",
      'Follow the "Responding to Messages" instructions in CLAUDE.md.',
      isGroup
        ? `This is a GROUP chat — do NOT use the imsg MCP send_message tool (it only supports 1:1 numbers/emails). Reply with: imsg send --chat-id ${chatId} --text "..." via Bash. Use the imsg MCP get_history tool with chat_id=${chatId} to pull recent context before replying if useful. This was queued because the text contains "atlas" — that only means the WORD appeared, not that the message is necessarily directed at you (people talk about you in the third person, or the word could appear incidentally). Check the actual content and conversational context before replying; if it's not really addressed to you, it's fine to stay silent.`
        : "",
      "Read your memory files for context. Send your reply via the imsg MCP tool.",
    ].filter(Boolean).join("\n");

    const logLabel = isGroup ? `group ${chatId} (${sender})` : sender;
    log(`DISPATCH: ${logLabel} (${messages.length} msg) — ${text.slice(0, 80)}`);

    const args = ["--print", "--chrome", "--model", MODEL];

    const sessionKey = sessionKeyFor({ sender, isGroup, chatId });
    const { id: sid, isNew } = getOrCreateSession(sessionKey);
    let fullPrompt = prompt;
    if (isNew) {
      // First dispatch for this session — create it, inject context
      args.push("--session-id", sid);
      fullPrompt = buildContext() + prompt;
    } else {
      args.push("--resume", sid);
    }

    args.push(fullPrompt);
    log(`SPAWN: claude ${isNew ? "--session-id" : "--resume"} ${sid} [session=${sessionKey}]`);

    const claude = spawn("claude", args, {
      cwd: IGLOO_HOME,
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnv(),
    });

    let stdout = "";
    let stderr = "";
    claude.stdout.on("data", (d) => (stdout += d));
    claude.stderr.on("data", (d) => (stderr += d));

    // Safety timeout: configurable via IGLOO_MESSAGE_TIMEOUT_MINUTES, default 15.
    // Cleared on process exit — a logged TIMEOUT always means a real hang.
    const killTimer = setTimeout(() => {
      claude.kill("SIGTERM");
      log(`CLAUDE TIMEOUT: killed after ${MESSAGE_TIMEOUT_MINUTES}m for ${sender}`);
      resolvePromise();
    }, MESSAGE_TIMEOUT_MINUTES * 60 * 1000);

    claude.on("close", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        log(`CLAUDE EXIT ${code}: ${stderr.slice(0, 200)}`);
      } else {
        log(`CLAUDE OK: responded to ${sender}`);
      }
      resolvePromise();
    });

    claude.on("error", (err) => {
      clearTimeout(killTimer);
      log(`CLAUDE SPAWN ERROR: ${err.message}`);
      reject(err);
    });
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

    const args = ["--print", "--chrome", "--model", MODEL];
    const owner = schedule.owner || "azhar";
    const { id: sid, isNew } = getOrCreateSession(owner);
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

      clearTimeout(killTimer);
      updateScheduleState(schedule.id, {
        lastRunAtMs: startMs,
        lastDurationMs: durationMs,
        lastStatus: code === 0 ? "ok" : "error",
      });
      resolvePromise();
    });

    claude.on("error", (err) => {
      clearTimeout(killTimer);
      log(`SCHEDULE SPAWN ERROR [${schedule.id}]: ${err.message}`);
      resolvePromise();
    });

    // Safety timeout: per-schedule "timeoutMinutes" field, default 10 min.
    // Cleared on process exit — a logged TIMEOUT always means a real hang.
    const timeoutMinutes = schedule.timeoutMinutes || 10;
    const killTimer = setTimeout(() => {
      claude.kill("SIGTERM");
      log(`SCHEDULE TIMEOUT [${schedule.id}]: killed after ${timeoutMinutes}m`);
      resolvePromise();
    }, timeoutMinutes * 60 * 1000);
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
let currentSchedules = [];

function setupCrons() {
  for (const c of activeCrons) c.stop();
  activeCrons = [];

  const schedules = loadSchedules();
  currentSchedules = schedules;

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

// Matches "@Atlas" or bare "Atlas" in the plain-text field.
const GROUP_MENTION_RE = /@?\batlas\b/i;

function handleMessage(params) {
  const message = params?.message;
  if (!message) return;

  // Advance the high-water mark and dedup against catch-up overlap. Own
  // messages advance it too — we never want a catch-up scan to replay them.
  if (markSeen(Number(message.id) || 0)) return;

  // Skip our own messages
  if (message.is_from_me) return;

  // message.is_group from the imsg CLI has been observed to misreport `false`
  // for genuine multi-participant threads, so participant count is the primary
  // signal and is_group is only an OR'd fallback.
  const isGroup =
    (Array.isArray(message.participants) && message.participants.length > 1) ||
    !!message.is_group;
  const chatId = message.chat_id;
  const sender =
    message.sender ||
    message.chat_identifier ||
    message.participants?.[0] ||
    "unknown";

  // Gate: 1:1 messages are gated by the individual sender; group messages are
  // gated by the group's chat_identifier so any member of an allowed group
  // can trigger a response without each member needing to be allowlisted.
  const gateKey = isGroup ? message.chat_identifier || String(chatId) : sender;
  if (!isAllowed(gateKey)) {
    log(`BLOCKED: ${isGroup ? `group ${gateKey}` : sender} (not in allowed senders)`);
    return;
  }

  const text = message.text || "";
  if (!text) return;

  // In groups, only wake up when the text mentions this agent — otherwise
  // every message between other participants would trigger a full dispatch.
  if (isGroup && !GROUP_MENTION_RE.test(text)) {
    return;
  }

  // Handle /new command — reset session. Only honored 1:1, so a mention in an
  // allowed group can't be used by any member to wipe the persistent session.
  if (!isGroup && text.trim() === "/new") {
    const key = sessionKeyFor({ sender, isGroup: false, chatId });
    try { unlinkSync(sessionFile(key)); } catch {}
    log(`NEW SESSION: reset by ${sender} (session=${key})`);
    spawn("imsg", ["send", "--to", sender, "--text", "Session reset. Next message starts fresh."]);
    return;
  }

  // Debounce: batch rapid messages from the same conversation. Groups key by
  // chat_id (so bursts from different participants in the same thread still
  // batch together); 1:1s key by sender as before.
  const bufferKey = isGroup ? `group:${chatId}` : sender;
  const meta = { sender, isGroup, chatId };

  if (buffer.has(bufferKey)) {
    const entry = buffer.get(bufferKey);
    clearTimeout(entry.timer);
    entry.messages.push({ text, raw: message });
    entry.timer = setTimeout(() => {
      const msgs = buffer.get(bufferKey).messages;
      buffer.delete(bufferKey);
      enqueueMessage(meta, msgs);
    }, DEBOUNCE_MS);
  } else {
    buffer.set(bufferKey, {
      meta,
      messages: [{ text, raw: message }],
      timer: setTimeout(() => {
        const msgs = buffer.get(bufferKey).messages;
        buffer.delete(bufferKey);
        enqueueMessage(meta, msgs);
      }, DEBOUNCE_MS),
    });
  }
}

// ── Catch-up scan: replay messages that arrived while the daemon was down ───

function decodeAttributedHex(hexStr) {
  if (!hexStr) return null;
  try {
    const buf = Buffer.from(hexStr, "hex");
    const i0 = buf.indexOf(Buffer.from("NSString"));
    if (i0 === -1) return null;
    let i = i0 + 8 + 5;
    let len;
    if (buf[i] === 0x81) {
      len = buf.readUInt16LE(i + 1);
      i += 3;
    } else {
      len = buf[i];
      i += 1;
    }
    return buf.slice(i, i + len).toString("utf8");
  } catch {
    return null;
  }
}

function sqlite(sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sqlite3", ["-separator", "\x1f", `file:${CHAT_DB}?mode=ro`, sql]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? resolvePromise(out) : reject(new Error(err.trim() || `sqlite3 exit ${code}`))
    );
  });
}

async function catchUpScan() {
  try {
    if (!stateLoaded || !hwmRowid) {
      // First run under this feature: initialize to the current max so we
      // don't replay history, and start tracking from here.
      const max = await sqlite("SELECT COALESCE(MAX(ROWID),0) FROM message;");
      hwmRowid = Number(max.trim()) || 0;
      saveDispatchState();
      log(`CATCHUP INIT: high-water mark set to rowid ${hwmRowid}`);
      return;
    }
    const rows = await sqlite(`
      SELECT m.ROWID, m.is_from_me,
             replace(COALESCE(m.text, ''), char(10), ' '),
             hex(m.attributedBody),
             COALESCE(h.id, ''), cmj.chat_id,
             COALESCE(c.chat_identifier, ''), c.style,
             (SELECT COUNT(*) FROM chat_handle_join WHERE chat_id = cmj.chat_id)
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ${Number(hwmRowid)}
      ORDER BY m.ROWID LIMIT 200;`);
    const lines = rows.split("\n").filter(Boolean);
    if (!lines.length) return;
    log(`CATCHUP: replaying ${lines.length} message(s) missed while down`);
    for (const line of lines) {
      const [rowid, isFromMe, text, bodyHex, handleId, chatId, chatIdent, style, nHandles] =
        line.split("\x1f");
      handleMessage({
        message: {
          id: Number(rowid),
          is_from_me: Number(isFromMe) === 1,
          text: (text && text.trim()) || decodeAttributedHex(bodyHex) || "",
          sender: handleId || undefined,
          chat_id: Number(chatId),
          chat_identifier: chatIdent || undefined,
          is_group: Number(style) === 43 || Number(nHandles) > 1,
        },
      });
    }
  } catch (e) {
    log(`CATCHUP ERROR: ${e.message}`);
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

  const pending = loadDispatchState();

  // Always start scheduler
  setupCrons();
  watchSchedules();

  // Requeue anything that was pending when the previous daemon stopped
  restorePending(pending);

  // Only start iMessage if enabled
  if (toolEnabled("imsg")) {
    runImsg();
    // After the live watch is up, replay anything that arrived while we were
    // down. Overlap with the live stream is deduped via seenRowids/HWM.
    setTimeout(catchUpScan, 3000);
  } else {
    log("iMessage disabled — scheduler-only mode");
    // croner timers keep the process alive
  }
}

// ── Signal handlers ─────────────────────────────────────────────────────────

function shutdown(signal) {
  log(`LISTENER STOP (${signal})`);
  // Flush debounce buffers into lanes so buffered messages persist too
  for (const [, entry] of buffer) {
    clearTimeout(entry.timer);
    if (entry.meta) {
      laneFor(sessionKeyFor(entry.meta)).queue.push({
        kind: "message",
        meta: entry.meta,
        messages: entry.messages,
      });
    }
  }
  buffer.clear();
  saveDispatchState();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

run();
