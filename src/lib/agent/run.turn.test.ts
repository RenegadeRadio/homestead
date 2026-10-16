import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderMocks } from "@/test-support/provider-mocks";

const providerMocks = await vi.hoisted(async () => {
  const { createProviderMocks } = await import("@/test-support/provider-mocks");
  return createProviderMocks();
});

vi.mock("@/lib/agent/providers", () => providerMocks);

describe("Bot turn persistence and cancellation", () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    resetProviderMocks(providerMocks);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-turn-"));
    process.env.CREW_DATA_DIR = dataDir;
    const { STORE_PATH } = await import("@/lib/paths");
    const { createSeedStore } = await import("@/lib/seed");
    const store = createSeedStore();
    const provider = store.providers.find((item) => item.id === "prov_openai")!;
    provider.apiKey = "test-key";
    const bot = store.bots.find((item) => item.id === "bot_atlas")!;
    bot.providerId = provider.id;
    bot.model = provider.defaultModel;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function deferredCompletion() {
    let resolve!: (value: { content: string; tool_calls: [] }) => void;
    const promise = new Promise<{ content: string; tool_calls: [] }>((done) => { resolve = done; });
    providerMocks.openaiComplete.mockReturnValueOnce(promise);
    return { resolve };
  }

  it("saves the user message and allows another store update while the provider waits", async () => {
    const pending = deferredCompletion();
    const { STORE_PATH } = await import("@/lib/paths");
    const { handleUserMessage } = await import("@/lib/agent/run");
    const { updateStore } = await import("@/lib/store");
    const turn = handleUserMessage({ conversationId: "convo_atlas", text: "saved early", emit: vi.fn() });
    await vi.waitFor(() => expect(providerMocks.openaiComplete).toHaveBeenCalled());

    let disk = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    expect(disk.messages.some((message: { parts: { text?: string }[] }) =>
      message.parts.some((part) => part.text === "saved early"))).toBe(true);

    await updateStore((store) => { store.settings.shellPolicy = "allow"; });
    disk = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    expect(disk.settings.shellPolicy).toBe("allow");

    pending.resolve({ content: "done", tool_calls: [] });
    await turn;
  });

  it("saves a pending approval before the paused turn returns", async () => {
    providerMocks.openaiComplete.mockResolvedValueOnce({
      content: "",
      tool_calls: [{ id: "t1", name: "run_command", arguments: { command: "rm -rf /" } }],
    });
    const { STORE_PATH } = await import("@/lib/paths");
    const { handleUserMessage } = await import("@/lib/agent/run");

    await handleUserMessage({ conversationId: "convo_atlas", text: "do it", emit: vi.fn() });

    const disk = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    expect(disk.pendingApprovals).toHaveLength(1);
  });

  it("aborts the provider signal when Stop is called", async () => {
    let capturedSignal: AbortSignal | undefined;
    providerMocks.openaiComplete.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const { handleUserMessage, stopConversation } = await import("@/lib/agent/run");
    const turn = handleUserMessage({ conversationId: "convo_atlas", text: "wait", emit: vi.fn() });
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());

    stopConversation("convo_atlas");

    expect(capturedSignal?.aborted).toBe(true);
    await turn;
  });
});
