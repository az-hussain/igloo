#!/usr/bin/env node

/**
 * Google CLI (gog) MCP Server
 *
 * Wraps the `gog` CLI tool (https://github.com/gogcli/gog)
 * as an MCP server for Gmail, Calendar, Contacts, Drive, and Tasks.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const GOG = "gog";
const TIMEOUT = 30_000;

async function run(args, timeout = TIMEOUT) {
  try {
    const { stdout, stderr } = await exec(GOG, args, {
      timeout,
      env: { ...process.env, GOGCLI_AUTH_STORE: "file" },
    });
    return stdout.trim();
  } catch (err) {
    throw new Error(
      `gog ${args.join(" ")} failed: ${err.stderr?.trim() || err.message}`
    );
  }
}

/** Add --account and --json flags to args if provided. */
function withAccount(args, account) {
  args.push("--json");
  if (account) args.push("--account", account);
  return args;
}

const server = new McpServer({
  name: "gog",
  version: "1.0.0",
});

// ── Gmail ───────────────────────────────────────────────────────────────────

server.tool(
  "gmail_search",
  "Search Gmail threads using Gmail query syntax (e.g. 'from:alice subject:hello')",
  {
    query: z.string().describe("Gmail search query"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ query, account }) => {
    const args = withAccount(["gmail", "search", query], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "gmail_get",
  "Get a specific email message by ID",
  {
    message_id: z.string().describe("Gmail message ID"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ message_id, account }) => {
    const args = withAccount(["gmail", "get", message_id], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Calendar ────────────────────────────────────────────────────────────────

server.tool(
  "calendar_events",
  "List upcoming calendar events",
  {
    calendar_id: z.string().optional().describe("Calendar ID (omit for all calendars)"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ calendar_id, account }) => {
    const args = calendar_id
      ? withAccount(["calendar", "events", calendar_id], account)
      : withAccount(["calendar", "events"], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "calendar_create",
  "Create a new calendar event",
  {
    calendar_id: z.string().describe("Calendar ID to create event in"),
    summary: z.string().describe("Event title"),
    start: z.string().describe("Start time (ISO8601 or natural language)"),
    end: z.string().describe("End time (ISO8601 or natural language)"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ calendar_id, summary, start, end, description, location, account }) => {
    const args = ["calendar", "create", calendar_id, "--summary", summary, "--start", start, "--end", end];
    if (description) args.push("--description", description);
    if (location) args.push("--location", location);
    args.push("--json");
    if (account) args.push("--account", account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "calendar_list",
  "List available calendars",
  {
    account: z.string().optional().describe("Google account email"),
  },
  async ({ account }) => {
    const args = withAccount(["calendar", "calendars"], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Contacts ────────────────────────────────────────────────────────────────

server.tool(
  "contacts_search",
  "Search Google Contacts by name, email, or phone",
  {
    query: z.string().describe("Search query"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ query, account }) => {
    const args = withAccount(["contacts", "search", query], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "contacts_list",
  "List Google Contacts",
  {
    account: z.string().optional().describe("Google account email"),
  },
  async ({ account }) => {
    const args = withAccount(["contacts", "list"], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Drive ───────────────────────────────────────────────────────────────────

server.tool(
  "drive_search",
  "Full-text search across Google Drive",
  {
    query: z.string().describe("Search query"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ query, account }) => {
    const args = withAccount(["drive", "search", query], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "drive_list",
  "List files in a Google Drive folder",
  {
    folder_id: z.string().optional().describe("Folder ID (omit for root)"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ folder_id, account }) => {
    const args = folder_id
      ? withAccount(["drive", "ls", "--parent", folder_id], account)
      : withAccount(["drive", "ls"], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Tasks ───────────────────────────────────────────────────────────────────

server.tool(
  "tasks_lists",
  "List Google Tasks task lists",
  {
    account: z.string().optional().describe("Google account email"),
  },
  async ({ account }) => {
    const args = withAccount(["tasks", "lists", "list"], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "tasks_list",
  "List tasks in a specific task list",
  {
    tasklist_id: z.string().describe("Task list ID"),
    account: z.string().optional().describe("Google account email"),
  },
  async ({ tasklist_id, account }) => {
    const args = withAccount(["tasks", "list", tasklist_id], account);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("gog MCP server running");
}

main().catch((err) => {
  console.error("gog MCP server error:", err);
  process.exit(1);
});
