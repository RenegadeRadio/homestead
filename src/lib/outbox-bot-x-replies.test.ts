import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));
const handleUserMessage = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(async (fn: (store: import("@/lib/types").Store) => unknown) => fn(state.store)),
}));
vi.mock("@/lib/agent/run", () => ({ handleUserMessage }));

import { startNextOutboxItem } from "@/lib/outbox-bot";
import { createSeedStore } from "@/lib/seed";

describe("Outbox ignores X replies", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    state.store.settings.linkedinSendWindowEnd = state.store.settings.linkedinSendWindowStart = "09:00";
    vi.clearAllMocks();
  });

  it("starts nothing and leaves an X draft unchanged", async () => {
    state.store.xReplies = [{
      id: "xreply_1", postUrl: "https://x.com/a/status/1", author: "a",
      postExcerpt: "post", text: "reply", status: "draft",
      createdAt: new Date().toISOString(), createdBy: "operator",
    }];
    const before = structuredClone(state.store.xReplies[0]);
    await expect(startNextOutboxItem()).resolves.toEqual({ started: false, reason: "No approved items." });
    expect(handleUserMessage).not.toHaveBeenCalled();
    expect(state.store.xReplies[0]).toEqual(before);
  });
});
