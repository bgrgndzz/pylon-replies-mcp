#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PYLON_API_BASE = "https://api.usepylon.com";

function getApiToken() {
  const token = process.env.PYLON_API_TOKEN;
  if (!token) {
    throw new Error("PYLON_API_TOKEN environment variable is required");
  }
  return token;
}

async function pylonRequest(method, path, body) {
  const token = getApiToken();
  const res = await fetch(`${PYLON_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Pylon API ${method} ${path} failed (${res.status}): ${text}`
    );
  }

  return res.json();
}

const server = new McpServer({
  name: "pylon-replies",
  version: "1.0.0",
});

// Search issues to find the ticket to reply to
server.tool(
  "search_issues",
  "Search for Pylon issues/tickets by filters to find the one to reply to",
  {
    states: z
      .array(
        z.enum([
          "new",
          "waiting_on_you",
          "waiting_on_customer",
          "on_hold",
          "closed",
        ])
      )
      .optional()
      .describe("Filter by issue states"),
    account: z
      .string()
      .optional()
      .describe("Filter by account name or ID"),
    assignee: z
      .string()
      .optional()
      .describe("Filter by assignee name or ID"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    type: z
      .enum(["Conversation", "Ticket"])
      .optional()
      .describe("Filter by issue type"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Max results (default 25)"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from previous response"),
  },
  async (params) => {
    const body = {};
    if (params.states) body.states = params.states;
    if (params.account) body.account = params.account;
    if (params.assignee) body.assignee = params.assignee;
    if (params.tags) body.tags = params.tags;
    if (params.type) body.type = params.type;
    if (params.limit) body.limit = params.limit;
    if (params.cursor) body.cursor = params.cursor;

    const data = await pylonRequest("POST", "/issues/search", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Get issue details
server.tool(
  "get_issue",
  "Get full details for a Pylon issue/ticket by ID or number",
  {
    issue: z.string().describe("Issue ID (UUID) or issue number"),
  },
  async ({ issue }) => {
    const data = await pylonRequest("GET", `/issues/${issue}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Get messages for an issue (to find message_id for replying)
server.tool(
  "get_issue_messages",
  "Get all messages for an issue. Use this to find the message_id needed for reply_to_issue.",
  {
    issue: z.string().describe("Issue ID (UUID) or issue number"),
  },
  async ({ issue }) => {
    const data = await pylonRequest("GET", `/issues/${issue}/messages`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Reply to an issue (the core tool — customer-facing)
server.tool(
  "reply_to_issue",
  "Send a customer-facing reply on a Pylon issue. This is VISIBLE to the customer. Use get_issue_messages to find a message_id, or provide email_info for email-based tickets.",
  {
    issue: z.string().describe("Issue ID (UUID) or issue number"),
    body_html: z.string().describe("HTML content of the reply"),
    message_id: z
      .string()
      .optional()
      .describe(
        "ID of the message to reply to (get from get_issue_messages)"
      ),
    user_id: z
      .string()
      .optional()
      .describe("User ID to send reply as (defaults to API token owner)"),
    attachment_urls: z
      .array(z.string())
      .optional()
      .describe("URLs of attachments to include in the reply"),
    email_info: z
      .object({
        to_emails: z
          .array(z.string())
          .optional()
          .describe("Primary recipient email addresses"),
        cc_emails: z
          .array(z.string())
          .optional()
          .describe("CC recipient email addresses"),
        bcc_emails: z
          .array(z.string())
          .optional()
          .describe("BCC recipient email addresses"),
      })
      .optional()
      .describe(
        "Email routing details. Use when the ticket lacks a default recipient or to override recipients."
      ),
  },
  async ({
    issue,
    body_html,
    message_id,
    user_id,
    attachment_urls,
    email_info,
  }) => {
    const body = { body_html };
    if (message_id) body.message_id = message_id;
    if (user_id) body.user_id = user_id;
    if (attachment_urls) body.attachment_urls = attachment_urls;
    if (email_info) body.email_info = email_info;

    const data = await pylonRequest("POST", `/issues/${issue}/reply`, body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("pylon-replies MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
