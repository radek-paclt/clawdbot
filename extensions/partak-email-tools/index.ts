import { Type } from "@sinclair/typebox";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { jsonResult } from "clawdbot/plugin-sdk";

const PartakMessageSchema = Type.Object({
  content: Type.String({ description: "Message text" }),
  channel: Type.Optional(
    Type.Union([
      Type.Literal("telegram"),
      Type.Literal("discord"),
      Type.Literal("auto"),
    ])
  ),
  metadata: Type.Optional(
    Type.Object(
      {
        emailId: Type.Optional(Type.String()),
        expectReply: Type.Optional(Type.Boolean()),
        correlationId: Type.Optional(Type.String()),
      },
      { additionalProperties: true }
    )
  ),
});

const EmailReplySchema = Type.Object({
  emailId: Type.String({ description: "ID of email to reply to" }),
  body: Type.String({ description: "Reply text" }),
  subject: Type.Optional(Type.String({ description: "Optional subject override" })),
});

function extractUserIdFromInternalKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!key.startsWith("internal_")) return null;
  const rest = key.slice("internal_".length);
  const idx = rest.indexOf("_");
  if (idx <= 0) return null;
  return rest.slice(0, idx);
}

function resolveApiProxyBaseUrl(): string | null {
  const openrouter = process.env.OPENROUTER_BASE_URL;
  if (openrouter) {
    return openrouter.replace(/\/openrouter\/api\/?$/, "");
  }
  const openai = process.env.OPENAI_BASE_URL;
  if (openai) {
    return openai.replace(/\/openai\/v1\/?$/, "");
  }
  return process.env.API_PROXY_URL || null;
}

function resolveManagementBotUrl(): string {
  return process.env.MANAGEMENT_BOT_URL || "http://10.0.0.2:3100";
}

function requireInternalSecret(): string {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_SECRET not configured");
  }
  return secret;
}

function resolveWorkerId(): string | null {
  return process.env.WORKER_ID || process.env.CLAWDBOT_WORKER_ID || null;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

const plugin = {
  id: "partak-email-tools",
  name: "Partak Email Tools",
  description: "Internal tools for Parťák email notifications and replies.",
  configSchema: { parse: (value: unknown) => value ?? {} },
  register(api: ClawdbotPluginApi) {
    api.registerTool({
      name: "partak_message",
      label: "Partak Message",
      description: "Send a message to the user via management-bot (Telegram/Discord).",
      parameters: PartakMessageSchema,
      async execute(_toolCallId, params) {
        try {
          const userId = extractUserIdFromInternalKey();
          if (!userId) throw new Error("Unable to resolve userId from internal API key");

          const secret = requireInternalSecret();
          const workerId = resolveWorkerId();

          const payload = {
            content: String(params?.content || "").trim(),
            channel: params?.channel || "auto",
            metadata: params?.metadata || undefined,
          };

          if (!payload.content) throw new Error("content is required");

          const headers: Record<string, string> = {
            "X-Internal-Secret": secret,
            "X-User-Id": userId,
          };
          if (workerId) headers["X-Worker-Id"] = workerId;

          const result = await postJson(
            `${resolveManagementBotUrl()}/internal/notify`,
            headers,
            payload
          );

          return jsonResult({ success: true, result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ success: false, error: message });
        }
      },
    });

    api.registerTool({
      name: "email_reply",
      label: "Email Reply",
      description: "Send an email reply via api-proxy (Resend).",
      parameters: EmailReplySchema,
      async execute(_toolCallId, params) {
        try {
          const userId = extractUserIdFromInternalKey();
          if (!userId) throw new Error("Unable to resolve userId from internal API key");

          const secret = requireInternalSecret();
          const workerId = resolveWorkerId();
          if (!workerId) throw new Error("WORKER_ID not configured");

          const apiProxyBase = resolveApiProxyBaseUrl();
          if (!apiProxyBase) throw new Error("API proxy base URL not configured");

          const payload = {
            userId,
            inReplyTo: params?.emailId,
            body: String(params?.body || "").trim(),
            subject: params?.subject || undefined,
          };

          if (!payload.inReplyTo) throw new Error("emailId is required");
          if (!payload.body) throw new Error("body is required");

          const headers: Record<string, string> = {
            "X-Internal-Secret": secret,
            "X-User-Id": userId,
            "X-Worker-Id": workerId,
          };

          const result = await postJson(
            `${apiProxyBase}/internal/email/send`,
            headers,
            payload
          );

          return jsonResult({ success: true, result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ success: false, error: message });
        }
      },
    });
  },
};

export default plugin;
