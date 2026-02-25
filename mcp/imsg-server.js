#!/usr/bin/env node

/**
 * iMessage MCP Server
 *
 * Wraps the `imsg` CLI tool (https://github.com/steipete/imsg)
 * as an MCP server so Claude can send/read iMessages natively.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const IMSG = "imsg";
const TIMEOUT = 15_000;

async function run(args, timeout = TIMEOUT) {
  try {
    const { stdout, stderr } = await exec(IMSG, args, { timeout });
    return stdout.trim();
  } catch (err) {
    throw new Error(
      `imsg ${args.join(" ")} failed: ${err.stderr?.trim() || err.message}`
    );
  }
}

const server = new McpServer({
  name: "imsg",
  version: "1.0.0",
});

// --- Tools ---

server.tool(
  "list_chats",
  "List recent iMessage/SMS conversations",
  { limit: z.number().optional().default(10).describe("Number of chats to return") },
  async ({ limit }) => {
    const out = await run(["chats", "--json", "--limit", String(limit)]);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "get_history",
  "Get message history for a specific chat",
  {
    chat_id: z.number().describe("Chat row ID from list_chats"),
    limit: z.number().optional().default(20).describe("Number of messages to return"),
    start: z.string().optional().describe("ISO8601 start time filter (inclusive)"),
    end: z.string().optional().describe("ISO8601 end time filter (exclusive)"),
  },
  async ({ chat_id, limit, start, end }) => {
    const args = ["history", "--chat-id", String(chat_id), "--json", "--limit", String(limit)];
    if (start) args.push("--start", start);
    if (end) args.push("--end", end);
    const out = await run(args);
    return { content: [{ type: "text", text: out }] };
  }
);

server.tool(
  "send_message",
  "Send an iMessage or SMS to a phone number or email",
  {
    to: z.string().describe("Phone number (e.g. +14155551212) or email address"),
    text: z.string().describe("Message body"),
    service: z
      .enum(["imessage", "sms", "auto"])
      .optional()
      .default("auto")
      .describe("Delivery service"),
  },
  async ({ to, text, service }) => {
    const args = ["send", "--to", to, "--text", text];
    if (service !== "auto") args.push("--service", service);
    const out = await run(args);
    return { content: [{ type: "text", text: out || "Message sent." }] };
  }
);

server.tool(
  "send_file",
  "Send a file/image via iMessage",
  {
    to: z.string().describe("Phone number or email"),
    file: z.string().describe("Absolute path to the file to send"),
    text: z.string().optional().describe("Optional accompanying message"),
  },
  async ({ to, file, text }) => {
    const args = ["send", "--to", to, "--file", file];
    if (text) args.push("--text", text);
    const out = await run(args);
    return { content: [{ type: "text", text: out || "File sent." }] };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("imsg MCP server running");
}

main().catch((err) => {
  console.error("imsg MCP server error:", err);
  process.exit(1);
});
