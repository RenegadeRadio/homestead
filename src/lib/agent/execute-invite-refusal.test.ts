import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/browser")>(),
  browserSnapshot: vi.fn(), browserClick: vi.fn(), browserPageText: vi.fn(),
}));

import { browserClick, browserPageText, browserSnapshot } from "@/lib/browser";
import { executeApprovedAction, type ToolContext } from "@/lib/agent/execute";
import { linkedInBudgetIO } from "@/lib/agent/linkedin-budget";
import { createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";
import type { PendingApproval } from "@/lib/types";

const url = "https://www.linkedin.com/in/sharon-test";
const refusal = "Your invitation to Sharon was not sent because you have reached the weekly limit for connection invitations.";

describe("approved invite refusal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-26T10:00:00.000Z");
    vi.spyOn(linkedInBudgetIO, "sleep").mockResolvedValue();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("does not record a refused Send invitation", async () => {
    const store = createSeedStore();
    store.settings.linkedinActionGapMinSeconds = store.settings.linkedinActionGapMaxSeconds = 0;
    store.settings.linkedinSendWindowStart = store.settings.linkedinSendWindowEnd = "09:00";
    const bot = store.bots[0];
    const ctx: ToolContext = { store, bot, conversationId: store.conversations[0].id, messageId: store.messages[0].id };
    const item = createOutboxItem(store, { name: "Sharon Test", profileUrl: url, text: "Hello", kind: "invite", createdBy: "operator" });
    item.status = "sending";
    store.linkedinSendLog = [{
      id: "prior", at: new Date().toISOString(), botId: bot.id, conversationId: ctx.conversationId,
      messageId: ctx.messageId, url, slug: "sharon-test", action: "click",
      label: '[3] button "Connect"', key: null, text: null, kind: "invite",
    }];
    vi.mocked(browserSnapshot).mockResolvedValue({ url, title: "LinkedIn", snapshot: '[5] button "Send invitation"', gate: { needed: false, reason: "" } });
    vi.mocked(browserClick).mockResolvedValue({ url, title: "LinkedIn", snapshot: "", gate: { needed: false, reason: "" }, blocked: false, result: "clicked", label: "Send invitation" });
    vi.mocked(browserPageText).mockResolvedValue(refusal);
    const approval: PendingApproval = {
      id: "approval", conversationId: ctx.conversationId, messageId: ctx.messageId, botId: bot.id,
      toolName: "browser_click", args: { ref: 5, label: '[5] button "Send invitation"' },
      createdAt: new Date().toISOString(), checkpoint: [], kind: "send", title: "Approve browser click?",
    };
    const result = await executeApprovedAction(approval, bot, store);
    expect(result).toContain("Nothing was recorded as sent");
    expect(store.linkedinSendLog).toHaveLength(1);
    expect(item.status).toBe("approved");
  });
});
