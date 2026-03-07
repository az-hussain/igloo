#!/usr/bin/env node

/**
 * Google Workspace MCP Server
 *
 * Wraps the `gws` CLI (https://github.com/googleworkspace/cli)
 * as an MCP server so Claude can access Gmail, Calendar, Drive, and more.
 *
 * Supports multiple Google accounts via GWS_ACCOUNTS_FILE — each account
 * gets its own config dir, and tools accept an optional `account` parameter
 * to select which account to use (defaults to the configured default).
 *
 * Convenience tools for common operations + a generic `execute` tool
 * for any gws command (the CLI auto-discovers all Google Workspace APIs).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

const GWS = "gws";
const TIMEOUT = 30_000;
const ACCOUNTS_FILE = process.env.GWS_ACCOUNTS_FILE;

// ── Account management ───────────────────────────────────────────────────────

function loadAccounts() {
  try {
    if (ACCOUNTS_FILE) {
      return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    }
  } catch {}
  return { default: null, accounts: {} };
}

function resolveConfigDir(accountName) {
  const config = loadAccounts();
  const name = accountName || config.default;
  if (!name) return null;
  const account = config.accounts[name];
  return account?.config_dir || null;
}

function accountNames() {
  const config = loadAccounts();
  return Object.keys(config.accounts);
}

function accountDescription() {
  const names = accountNames();
  if (names.length === 0) return "No accounts configured.";
  const config = loadAccounts();
  return names
    .map((n) => {
      const a = config.accounts[n];
      const tag = n === config.default ? " (default)" : "";
      return `${n}${tag}: ${a.email}`;
    })
    .join(", ");
}

// ── Run gws with account selection ───────────────────────────────────────────

async function run(args, account, timeout = TIMEOUT) {
  const env = { ...process.env };
  const configDir = resolveConfigDir(account);
  if (configDir) {
    env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = configDir;
  }
  try {
    const { stdout, stderr } = await exec(GWS, args, { timeout, env });
    return stdout.trim();
  } catch (err) {
    throw new Error(
      `gws ${args.join(" ")} failed: ${err.stderr?.trim() || err.message}`
    );
  }
}

// ── Shared schema for account parameter ──────────────────────────────────────

const accountParam = z
  .string()
  .optional()
  .describe(
    "Account name (e.g. 'personal', 'work'). Uses default account if omitted."
  );

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "gws",
  version: "1.0.0",
});

// ── Account info ─────────────────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List configured Google Workspace accounts and which is the default",
  {},
  async () => {
    const config = loadAccounts();
    const lines = [];
    for (const [name, info] of Object.entries(config.accounts)) {
      const tag = name === config.default ? " (default)" : "";
      lines.push(`${name}${tag}: ${info.email}`);
    }
    if (lines.length === 0) lines.push("No accounts configured.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── Generic execute (escape hatch for any Google API) ────────────────────────

server.tool(
  "execute",
  "Execute any gws command. The CLI auto-discovers all Google Workspace APIs. Use `gws schema <method>` to introspect request/response schemas.",
  {
    args: z
      .array(z.string())
      .describe(
        'Arguments to pass to gws, e.g. ["drive", "files", "list", "--params", "{\\"pageSize\\": 5}"]'
      ),
    account: accountParam,
  },
  async ({ args, account }) => {
    const out = await run(args, account);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "schema",
  "Introspect any Google API method's request/response schema",
  {
    method: z
      .string()
      .describe(
        "API method to inspect, e.g. drive.files.list, gmail.users.messages.get"
      ),
  },
  async ({ method }) => {
    const out = await run(["schema", method]);
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Gmail ────────────────────────────────────────────────────────────────────

server.tool(
  "gmail_search",
  "Search Gmail messages using Gmail query syntax (e.g. 'from:alice subject:hello is:unread')",
  {
    query: z.string().describe("Gmail search query"),
    max_results: z
      .number()
      .optional()
      .default(10)
      .describe("Max messages to return"),
    account: accountParam,
  },
  async ({ query, max_results, account }) => {
    const params = { userId: "me", q: query, maxResults: max_results };
    const out = await run(
      [
        "gmail", "users", "messages", "list",
        "--params", JSON.stringify(params),
      ],
      account
    );
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "gmail_get",
  "Get a specific Gmail message by ID",
  {
    message_id: z.string().describe("Gmail message ID"),
    format: z
      .enum(["full", "metadata", "minimal", "raw"])
      .optional()
      .default("full")
      .describe("Response format"),
    account: accountParam,
  },
  async ({ message_id, format, account }) => {
    const params = { userId: "me", id: message_id, format };
    const out = await run(
      [
        "gmail", "users", "messages", "get",
        "--params", JSON.stringify(params),
      ],
      account
    );
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "gmail_send",
  "Send an email via Gmail",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body (plain text)"),
    account: accountParam,
  },
  async ({ to, subject, body, account }) => {
    const message = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
    const raw = Buffer.from(message).toString("base64url");
    const out = await run(
      [
        "gmail", "users", "messages", "send",
        "--params", JSON.stringify({ userId: "me" }),
        "--json", JSON.stringify({ raw }),
      ],
      account
    );
    return { content: [{ type: "text", text: out || "Email sent." }] };
  }
);

// ── Calendar ─────────────────────────────────────────────────────────────────

server.tool(
  "calendar_list_events",
  "List upcoming calendar events",
  {
    calendar_id: z
      .string()
      .optional()
      .default("primary")
      .describe("Calendar ID"),
    max_results: z
      .number()
      .optional()
      .default(10)
      .describe("Max events to return"),
    time_min: z
      .string()
      .optional()
      .describe("Start time filter (ISO8601). Defaults to now."),
    account: accountParam,
  },
  async ({ calendar_id, max_results, time_min, account }) => {
    const params = {
      calendarId: calendar_id,
      maxResults: max_results,
      singleEvents: true,
      orderBy: "startTime",
    };
    if (time_min) params.timeMin = time_min;
    else params.timeMin = new Date().toISOString();
    const out = await run(
      [
        "calendar", "events", "list",
        "--params", JSON.stringify(params),
      ],
      account
    );
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "calendar_create_event",
  "Create a new calendar event",
  {
    summary: z.string().describe("Event title"),
    start: z.string().describe("Start time (ISO8601)"),
    end: z.string().describe("End time (ISO8601)"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    calendar_id: z
      .string()
      .optional()
      .default("primary")
      .describe("Calendar ID"),
    account: accountParam,
  },
  async ({ summary, start, end, description, location, calendar_id, account }) => {
    const event = {
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
    };
    if (description) event.description = description;
    if (location) event.location = location;
    const out = await run(
      [
        "calendar", "events", "insert",
        "--params", JSON.stringify({ calendarId: calendar_id }),
        "--json", JSON.stringify(event),
      ],
      account
    );
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Drive ────────────────────────────────────────────────────────────────────

server.tool(
  "drive_search",
  "Search Google Drive files by name or content",
  {
    query: z
      .string()
      .describe("Drive search query (e.g. name contains 'report')"),
    max_results: z
      .number()
      .optional()
      .default(10)
      .describe("Max files to return"),
    account: accountParam,
  },
  async ({ query, max_results, account }) => {
    const params = { q: query, pageSize: max_results };
    const out = await run(
      [
        "drive", "files", "list",
        "--params", JSON.stringify(params),
      ],
      account
    );
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "drive_list",
  "List files in a Google Drive folder",
  {
    folder_id: z
      .string()
      .optional()
      .describe("Folder ID (omit for root)"),
    max_results: z
      .number()
      .optional()
      .default(10)
      .describe("Max files to return"),
    account: accountParam,
  },
  async ({ folder_id, max_results, account }) => {
    const params = { pageSize: max_results };
    if (folder_id) params.q = `'${folder_id}' in parents`;
    const out = await run(
      [
        "drive", "files", "list",
        "--params", JSON.stringify(params),
      ],
      account
    );
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const desc = accountDescription();
  console.error(`gws MCP server running — ${desc}`);
}

main().catch((err) => {
  console.error("gws MCP server error:", err);
  process.exit(1);
});
