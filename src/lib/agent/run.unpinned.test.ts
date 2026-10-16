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

describe("turn completion and cancellation", () => {
  let dataDir: string;
  let storePath: string;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    resetProviderMocks(providers);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-run-unpinned-"));
    process.env.CREW_DATA_DIR = dataDir;
    const { STORE_PATH } = await import("@/lib/paths");
    const { createSeedStore } = await import("@/lib/seed");
    storePath = STORE_PATH;
    const store = createSeedStore();
    const provider = store.providers.find((item) => item.id === "prov_openai")!;
    provider.apiKey = "key";
    store.bots.find((item) => item.id === "bot_atlas")!.providerId = provider.id;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("persists a provider text reply when handleUserMessage ends", async () => {
    providers.openaiComplete.mockResolvedValueOnce({ content: "Hi from the bot", tool_calls: [] });
    const { handleUserMessage } = await import("@/lib/agent/run");
    await handleUserMessage({ conversationId: "convo_atlas", text: "hello", emit: vi.fn() });

    const disk = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const reply = disk.messages.filter((message: { role: string }) => message.role === "assistant").at(-1);
    expect(reply.parts.map((part: { text?: string }) => part.text || "").join(""))
      .toContain("Hi from the bot");
  });

  it("passes the turn signal to Anthropic and Stop aborts it", async () => {
    const disk = JSON.parse(fs.readFileSync(storePath, "utf8"));
    disk.providers.find((item: { id: string }) => item.id === "prov_anthropic").apiKey = "key";
    disk.bots.find((item: { id: string }) => item.id === "bot_atlas").providerId = "prov_anthropic";
    fs.writeFileSync(storePath, JSON.stringify(disk, null, 2));
    let captured: AbortSignal | undefined;
    providers.anthropicComplete.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      captured = signal;
      return new Promise((_resolve, reject) => signal.addEventListener(
        "abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }
      ));
    });
    const { handleUserMessage, stopConversation } = await import("@/lib/agent/run");
    const turn = handleUserMessage({ conversationId: "convo_atlas", text: "wait", emit: vi.fn() });
    await vi.waitFor(() => expect(captured).toBeDefined());

    stopConversation("convo_atlas");

    expect(captured?.aborted).toBe(true);
    await turn;
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
