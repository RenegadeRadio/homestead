import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/web", () => ({ fetchUrl: vi.fn(), webSearch: vi.fn() }));

import { executeTool, type ToolContext } from "@/lib/agent/execute";
import { createSeedStore } from "@/lib/seed";

function context(): ToolContext {
  const store = createSeedStore();
  return {
    store,
    bot: store.bots[0],
    conversationId: store.conversations[0].id,
    messageId: store.messages[0].id,
  };
}

describe("record_x_reply postAt", () => {
  it("stores an ISO postAt and refuses a non-date value", async () => {
    const ctx = context();
    const valid = {
      postUrl: "https://x.com/handle/status/100",
      author: "handle",
      postExcerpt: "A post",
      text: "A reply",
      postAt: "2026-10-08T08:00:00.000Z",
    };
    await executeTool("record_x_reply", valid, ctx);
    expect(ctx.store.xReplies?.[0].postAt).toBe(valid.postAt);

    const refused = await executeTool("record_x_reply", {
      ...valid,
      postUrl: "https://x.com/handle/status/101",
      postAt: "yesterday",
    }, ctx);
    expect(refused.result).toMatch(/^Refused:/);
    expect(ctx.store.xReplies).toHaveLength(1);
  });
});
