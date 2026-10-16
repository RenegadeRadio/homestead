import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: undefined as unknown as import("@/lib/types").Store }));

vi.mock("@/lib/store", () => ({
  getStore: vi.fn(async () => state.store),
}));

import { GET, POST } from "@/app/api/outbox/route";
import { createOutboxItem } from "@/lib/outbox";
import { createSeedStore } from "@/lib/seed";

function request(method: "GET" | "POST") {
  return new Request("http://127.0.0.1:43177/api/outbox", {
    method,
    headers: {
      Host: "127.0.0.1:43177",
      Origin: "http://127.0.0.1:43177",
    },
  });
}

describe("/api/outbox", () => {
  beforeEach(() => {
    state.store = createSeedStore();
    globalThis.__crewOutboxRunning = false;
  });

  afterEach(() => {
    globalThis.__crewOutboxRunning = false;
    vi.clearAllMocks();
  });

  it("does not start another run while one is in progress", async () => {
    globalThis.__crewOutboxRunning = true;

    const response = await POST(request("POST"));

    await expect(response.json()).resolves.toEqual({ started: false });
    expect(globalThis.__crewOutboxRunning).toBe(true);
  });

  it("returns the outbox items together with running state", async () => {
    createOutboxItem(state.store, {
      name: "Ada",
      profileUrl: "https://www.linkedin.com/in/ada",
      text: "Hello Ada",
      createdBy: "operator",
    });
    globalThis.__crewOutboxRunning = true;

    const response = await GET(request("GET"));

    await expect(response.json()).resolves.toEqual({
      running: true,
      items: state.store.outbox,
    });
  });
});
