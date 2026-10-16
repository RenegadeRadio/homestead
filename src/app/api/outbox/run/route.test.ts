import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
  updateStore: vi.fn(),
}));

import { GET } from "@/app/api/outbox/run/route";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

function request() {
  return new Request("http://127.0.0.1:43177/api/outbox/run", {
    method: "GET",
    headers: {
      Host: "127.0.0.1:43177",
      Origin: "http://127.0.0.1:43177",
    },
  });
}

describe("GET /api/outbox/run", () => {
  let item: OutboxItem;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-19T14:11:47.000Z");
    state.store = createSeedStore();
    item = {
      id: "outbox_mary",
      name: "Mary Somerville S.",
      profileUrl: "https://www.linkedin.com/in/amber-michelle/",
      text: "Hello Mary",
      kind: "invite",
      status: "sending",
      sendingAt: "2026-09-19T13:40:47.000Z",
      createdAt: "2026-09-19T13:30:00.000Z",
      createdBy: state.store.bots[0].id,
    };
    (state.store.outbox ??= []).push(item);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reports an inactive sending item after the stall threshold", async () => {
    const response = await GET(request());

    await expect(response.json()).resolves.toMatchObject({
      stalled: { id: item.id, name: item.name },
    });
  });

  it("does not report a stall when the profile has newer activity", async () => {
    state.store.linkedinSendLog = [{
      id: "send_recent",
      at: "2026-09-19T14:06:47.000Z",
      botId: "bot_test",
      conversationId: "conv_test",
      messageId: "msg_test",
      url: item.profileUrl,
      slug: "amber-michelle",
      action: "click",
      label: "Connect",
      key: null,
      text: null,
      kind: "invite",
    }];

    const response = await GET(request());

    await expect(response.json()).resolves.toMatchObject({ stalled: null });
  });
});
