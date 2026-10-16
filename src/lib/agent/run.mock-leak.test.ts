import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderMocks } from "@/test-support/provider-mocks";

const providers = await vi.hoisted(async () => {
  const { createProviderMocks } = await import("@/test-support/provider-mocks");
  return createProviderMocks();
});
vi.mock("@/lib/agent/providers", () => providers);

describe("provider mock reset", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    resetProviderMocks(providers);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-run-mock-leak-"));
    process.env.CREW_DATA_DIR = dataDir;
    const { STORE_PATH } = await import("@/lib/paths");
    const { createSeedStore } = await import("@/lib/seed");
    const store = createSeedStore();
    const provider = store.providers.find((item) => item.id === "prov_openai")!;
    provider.apiKey = "key";
    store.bots.find((item) => item.id === "bot_atlas")!.providerId = provider.id;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("queues a provider response without consuming it", () => {
    providers.openaiComplete.mockResolvedValueOnce({ content: "unused", tool_calls: [] });
  });

  it("reports Stopped when a provider fails differently after cancellation", async () => {
    providers.openaiComplete.mockImplementationOnce(({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => signal.addEventListener(
        "abort", () => reject(new Error("socket hang up")), { once: true }
      ))
    );
    const emit = vi.fn();
    const { handleUserMessage, stopConversation } = await import("@/lib/agent/run");
    const turn = handleUserMessage({ conversationId: "convo_atlas", text: "wait", emit });
    await vi.waitFor(() => expect(providers.openaiComplete).toHaveBeenCalled());

    stopConversation("convo_atlas");
    await turn;

    expect(emit).toHaveBeenCalledWith({ type: "error", message: "Stopped." });
  });
});
