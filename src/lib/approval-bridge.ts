import type { Bot, OutboxItem, PendingApproval } from "@/lib/types";

export interface BridgeConfig {
  token: string;
  chatId: string;
}

export type BridgeConfigResult =
  | { ok: true; config: BridgeConfig }
  | { ok: false; error: string };

export function resolveBridgeConfig(
  env: {
    CREW_TELEGRAM_TOKEN_FILE?: string;
    CREW_TELEGRAM_CHAT_ID?: string;
  },
  readFile: (path: string, encoding: "utf8") => string
): BridgeConfigResult {
  if (!env.CREW_TELEGRAM_TOKEN_FILE) {
    return { ok: false, error: "CREW_TELEGRAM_TOKEN_FILE is required." };
  }

  let token: string;
  try {
    token = readFile(env.CREW_TELEGRAM_TOKEN_FILE, "utf8").trim();
  } catch {
    return { ok: false, error: "Could not read the Telegram token file." };
  }
  if (!token) {
    return { ok: false, error: "The Telegram token file is empty." };
  }

  if (!env.CREW_TELEGRAM_CHAT_ID) {
    return { ok: false, error: "CREW_TELEGRAM_CHAT_ID is required." };
  }

  return {
    ok: true,
    config: { token, chatId: env.CREW_TELEGRAM_CHAT_ID },
  };
}

export function selectNewApprovals(
  pending: PendingApproval[],
  deliveredIds: ReadonlySet<string>
): PendingApproval[] {
  return pending.filter((approval) => !deliveredIds.has(approval.id));
}

function approvalDetail(args: Record<string, unknown>): string {
  const preferredFields = ["text", "command", "reason", "label", "key", "url"];
  for (const field of preferredFields) {
    const value = args[field];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(args);
}

export interface ApprovalCard {
  text: string;
  buttons: { text: string; callbackData: string }[];
}

export function buildApprovalCard(
  approval: PendingApproval,
  bot: Bot | undefined,
  outbox: OutboxItem[]
): ApprovalCard {
  const lines = [
    `Bot: ${bot?.name ?? approval.botId}`,
    `Tool: ${approval.toolName}`,
    `Approval: ${approval.title ?? "Approval required"}`,
    `Detail: ${approvalDetail(approval.args)}`,
  ];

  if (approval.kind === "send") {
    const sending = outbox.filter((item) => item.status === "sending");
    if (sending.length === 1) {
      lines.push(`Recipient: ${sending[0].name}`, `Text: ${sending[0].text}`);
    }
  }

  return {
    text: lines.join("\n"),
    buttons: [
      { text: "Approve", callbackData: `approve:${approval.id}` },
      { text: "Deny", callbackData: `deny:${approval.id}` },
    ],
  };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: string | number } };
  from: { id: string | number };
}

export interface TelegramUpdate {
  update_id?: number;
  callback_query?: TelegramCallbackQuery;
}

export type CallbackVerdict =
  | { kind: "ignored" }
  | { kind: "unauthorized"; callbackQueryId: string }
  | { kind: "already-handled"; callbackQueryId: string; approvalId: string }
  | {
      kind: "resolve";
      callbackQueryId: string;
      approvalId: string;
      decision: "approved" | "denied";
    };

export function evaluateUpdate(
  update: TelegramUpdate,
  allowedChatId: string,
  pendingIds: ReadonlySet<string>
): CallbackVerdict {
  const callback = update.callback_query;
  if (!callback) return { kind: "ignored" };

  const match = /^(approve|deny):(.+)$/.exec(callback.data ?? "");
  if (!match) return { kind: "ignored" };

  const senderId = callback.message?.chat.id ?? callback.from.id;
  if (String(senderId) !== allowedChatId) {
    return { kind: "unauthorized", callbackQueryId: callback.id };
  }

  const approvalId = match[2];
  if (!pendingIds.has(approvalId)) {
    return { kind: "already-handled", callbackQueryId: callback.id, approvalId };
  }

  return {
    kind: "resolve",
    callbackQueryId: callback.id,
    approvalId,
    decision: match[1] === "approve" ? "approved" : "denied",
  };
}
