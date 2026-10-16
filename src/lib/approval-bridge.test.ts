import { describe, expect, it } from "vitest";

import {
  buildApprovalCard,
  evaluateUpdate,
  resolveBridgeConfig,
  selectNewApprovals,
} from "@/lib/approval-bridge";
import type { Bot, OutboxItem, PendingApproval } from "@/lib/types";

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "approval-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    botId: "bot-1",
    toolName: "browser_type",
    args: { text: "Hello from Homestead" },
    createdAt: "2026-09-21T00:00:00.000Z",
    checkpoint: [],
    title: "Send a message",
    ...overrides,
  };
}

function callback(chatId: string, data = "approve:approval-1") {
  return {
    update_id: 1,
    callback_query: {
      id: "callback-1",
      data,
      from: { id: chatId },
      message: { chat: { id: chatId } },
    },
  };
}

describe("approval bridge decisions", () => {
  it("refuses an answer from a chat other than the allowlisted chat", () => {
    const verdict = evaluateUpdate(callback("stranger"), "operator", new Set(["approval-1"]));

    expect(verdict).toEqual({ kind: "unauthorized", callbackQueryId: "callback-1" });
    expect(verdict.kind).not.toBe("resolve");
  });

  it("delivers a newly pending approval but not one already delivered", () => {
    const pending = [approval(), approval({ id: "approval-2" })];

    expect(selectNewApprovals(pending, new Set(["approval-1"]))).toEqual([pending[1]]);
    expect(selectNewApprovals(pending, new Set(["approval-1", "approval-2"]))).toEqual([]);
  });

  it("includes the recipient and exact send text in a send card", () => {
    const bot = { id: "bot-1", name: "Scout" } as Bot;
    const item = {
      id: "outbox-1",
      name: "Ada Lovelace",
      text: "Hello Ada — exactly this text.",
      status: "sending",
    } as OutboxItem;

    const card = buildApprovalCard(approval({ kind: "send" }), bot, [item]);

    expect(card.text).toContain("Recipient: Ada Lovelace");
    expect(card.text).toContain("Text: Hello Ada — exactly this text.");
  });

  it("reports an answer for a no-longer-pending approval as already handled", () => {
    const verdict = evaluateUpdate(callback("operator"), "operator", new Set());

    expect(verdict).toEqual({
      kind: "already-handled",
      callbackQueryId: "callback-1",
      approvalId: "approval-1",
    });
    expect(verdict.kind).not.toBe("resolve");
  });

  it("names missing config variables without exposing fixture secrets", () => {
    const token = "fixture-token-that-must-not-leak";
    const chatId = "fixture-chat-id-that-must-not-leak";
    const noTokenFile = resolveBridgeConfig({}, () => token);
    const noChatId = resolveBridgeConfig(
      { CREW_TELEGRAM_TOKEN_FILE: "/private/token" },
      () => token
    );

    expect(noTokenFile).toEqual({
      ok: false,
      error: "CREW_TELEGRAM_TOKEN_FILE is required.",
    });
    expect(noChatId).toEqual({ ok: false, error: "CREW_TELEGRAM_CHAT_ID is required." });
    for (const result of [noTokenFile, noChatId]) {
      if (!result.ok) {
        expect(result.error).not.toContain(token);
        expect(result.error).not.toContain(chatId);
      }
    }
  });
});
