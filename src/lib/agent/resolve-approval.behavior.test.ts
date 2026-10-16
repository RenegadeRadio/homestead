import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedAction: vi.fn(),
  executeTool: vi.fn(),
  openaiComplete: vi.fn(),
  anthropicComplete: vi.fn(),
  syncPendingSends: vi.fn(async () => ({})),
}));

vi.mock("@/lib/agent/execute", () => ({
  executeApprovedAction: mocks.executeApprovedAction,
  executeTool: mocks.executeTool,
}));
vi.mock("@/lib/agent/providers", () => ({
  openaiComplete: mocks.openaiComplete,
  anthropicComplete: mocks.anthropicComplete,
}));
vi.mock("@/lib/crm/notion-sync", () => ({ syncPendingSends: mocks.syncPendingSends }));

describe("approval resolution behavior", () => {
  let dataDir: string;
  let storePath: string;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    vi.clearAllMocks();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-approval-"));
    process.env.CREW_DATA_DIR = dataDir;
    const { STORE_PATH } = await import("@/lib/paths");
    const { createSeedStore } = await import("@/lib/seed");
    storePath = STORE_PATH;
    const store = createSeedStore();
    const bot = store.bots.find((item) => item.id === "bot_atlas")!;
    const conversation = store.conversations.find((item) => item.id === "convo_atlas")!;
    store.messages.push({
      id: "msg_approval",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [{ type: "approval", id: "appr_test", title: "Approve", detail: "test", status: "pending" }],
      createdAt: "2026-09-17T00:00:00.000Z",
      reactions: [],
    });
    store.pendingApprovals.push({
      id: "appr_test",
      conversationId: conversation.id,
      messageId: "msg_approval",
      botId: bot.id,
      toolName: "browser_click",
      args: {},
      createdAt: "2026-09-17T00:00:00.000Z",
      checkpoint: [],
      kind: "send",
    });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("runs an approval only once when two resolutions overlap", async () => {
    mocks.executeApprovedAction.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve("ok"), 50))
    );
    const { resolveApproval } = await import("@/lib/agent/run");
    const firstEmit = vi.fn();
    const secondEmit = vi.fn();

    const first = resolveApproval({ approvalId: "appr_test", decision: "approved", emit: firstEmit });
    const second = resolveApproval({ approvalId: "appr_test", decision: "approved", emit: secondEmit });
    await Promise.all([first, second]);

    expect(mocks.executeApprovedAction).toHaveBeenCalledTimes(1);
    expect(secondEmit.mock.calls.map(([event]) => event)).toEqual([
      { type: "error", message: "This approval is already being handled." },
      { type: "done" },
    ]);
    expect(firstEmit.mock.calls.some(([event]) => event.type === "error")).toBe(false);
  });

  it("persists removal before waiting for the resumed provider turn", async () => {
    const disk = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const bot = disk.bots.find((item: { id: string }) => item.id === "bot_atlas");
    bot.providerId = "prov_openai";
    disk.providers.find((item: { id: string }) => item.id === "prov_openai").apiKey = "key";
    disk.pendingApprovals[0].toolName = "run_command";
    disk.pendingApprovals[0].kind = "shell";
    disk.pendingApprovals[0].checkpoint = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", name: "run_command", arguments: { command: "ls" } }] },
    ];
    fs.writeFileSync(storePath, JSON.stringify(disk, null, 2));
    mocks.executeApprovedAction.mockResolvedValueOnce("ok");
    let finish!: (value: { content: string; tool_calls: [] }) => void;
    mocks.openaiComplete.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { resolveApproval } = await import("@/lib/agent/run");

    const turn = resolveApproval({ approvalId: "appr_test", decision: "approved", emit: vi.fn() });
    await vi.waitFor(() => expect(mocks.openaiComplete).toHaveBeenCalled());
    expect(JSON.parse(fs.readFileSync(storePath, "utf8")).pendingApprovals).toEqual([]);

    finish({ content: "done", tool_calls: [] });
    await turn;
  });

  it("persists provider reply text at the end of a resumed turn", async () => {
    const disk = JSON.parse(fs.readFileSync(storePath, "utf8"));
    disk.bots.find((item: { id: string }) => item.id === "bot_atlas").providerId = "prov_openai";
    disk.providers.find((item: { id: string }) => item.id === "prov_openai").apiKey = "key";
    fs.writeFileSync(storePath, JSON.stringify(disk, null, 2));
    mocks.executeApprovedAction.mockResolvedValueOnce("ok");
    mocks.openaiComplete.mockResolvedValueOnce({ content: "All done", tool_calls: [] });
    const { resolveApproval } = await import("@/lib/agent/run");

    await resolveApproval({ approvalId: "appr_test", decision: "approved", emit: vi.fn() });

    const saved = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const message = saved.messages.find((item: { id: string }) => item.id === "msg_approval");
    expect(message.parts.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join(""))
      .toContain("All done");
  });
});
