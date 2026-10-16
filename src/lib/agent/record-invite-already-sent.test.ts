import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settled: vi.fn(),
}));

vi.mock("@/lib/outbox-bot", () => ({ onOutboxItemSettled: mocks.settled }));

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { approveOutboxItems, createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

const profileUrl = "https://www.linkedin.com/in/ada-lovelace";

function context(kind?: "message" | "invite") {
  const store = createSeedStore();
  const item = kind
    ? createOutboxItem(store, {
        name: "Ada Lovelace",
        profileUrl,
        text: "Hello Ada",
        kind,
        createdBy: "operator",
      })
    : undefined;
  if (item) {
    item.kind = kind;
    approveOutboxItems(store, { ids: [item.id] });
    item.status = "sending";
  }
  const ctx: ToolContext = {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
  return { ctx, item };
}

describe("record_invite_already_sent", () => {
  beforeEach(() => {
    mocks.settled.mockReset();
  });

  it("settles a matching sending invite and records the evidence once", async () => {
    const { ctx, item } = context("invite");
    const evidence = "Pending with a clock icon in the More menu";

    const outcome = await executeTool(
      "record_invite_already_sent",
      { profileUrl: `${profileUrl}/`, evidence },
      ctx
    );

    expect(item?.status).toBe("sent");
    expect(item?.operatorConfirmation?.evidence).toBe(`${ctx.bot.name}: ${evidence}`);
    expect(
      ctx.store.linkedinSendLog?.filter(
        (entry) =>
          entry.outboxItemId === item?.id && entry.kind === "invite" && !entry.voidedAt
      )
    ).toHaveLength(1);
    expect(mocks.settled).toHaveBeenCalledOnce();
    expect(mocks.settled).toHaveBeenCalledWith(ctx.store, "sent");
    expect(outcome.result).toContain("Ada Lovelace");
  });

  it("records nothing when there is no sending item for the profile", async () => {
    const { ctx } = context();
    const before = structuredClone(ctx.store);

    const outcome = await executeTool(
      "record_invite_already_sent",
      { profileUrl, evidence: "Pending in the More menu" },
      ctx
    );

    expect(ctx.store).toEqual(before);
    expect(mocks.settled).not.toHaveBeenCalled();
    expect(outcome.result).toContain("nothing was recorded");
  });

  it("records nothing when only a sending message matches the profile", async () => {
    const { ctx, item } = context("message");
    const before = structuredClone(ctx.store);

    const outcome = await executeTool(
      "record_invite_already_sent",
      { profileUrl, evidence: "Pending in the More menu" },
      ctx
    );

    expect(ctx.store).toEqual(before);
    expect(item?.status).toBe("sending");
    expect(ctx.store.linkedinSendLog ?? []).toHaveLength(0);
    expect(mocks.settled).not.toHaveBeenCalled();
    expect(outcome.result).toContain("nothing was recorded");
  });
});
