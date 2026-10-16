import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stopConversation } = vi.hoisted(() => ({ stopConversation: vi.fn() }));

vi.mock("@/lib/agent/run", () => ({ stopConversation }));

describe("clearConversation", () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    globalThis.__crewStore = undefined;
    stopConversation.mockReset();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crew-clear-"));
    process.env.CREW_DATA_DIR = dataDir;
  });

  afterEach(() => {
    delete process.env.CREW_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function arrange() {
    const { updateStore } = await import("@/lib/store");
    const messages = [
      {
        id: "message_one",
        conversationId: "conversation_one",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "First" }],
        createdAt: "2026-09-17T10:00:00.000Z",
        reactions: [],
      },
      {
        id: "message_two",
        conversationId: "conversation_one",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Second" }],
        createdAt: "2026-09-17T10:01:00.000Z",
        reactions: [],
      },
      {
        id: "message_other",
        conversationId: "conversation_other",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Keep" }],
        createdAt: "2026-09-17T10:02:00.000Z",
        reactions: [],
      },
    ];
    const approvals = [
      {
        id: "approval_one",
        conversationId: "conversation_one",
        messageId: "message_two",
        botId: "bot_one",
        toolName: "shell",
        args: { command: "pwd" },
        createdAt: "2026-09-17T10:01:30.000Z",
        checkpoint: [],
      },
      {
        id: "approval_other",
        conversationId: "conversation_other",
        messageId: "message_other",
        botId: "bot_one",
        toolName: "shell",
        args: { command: "ls" },
        createdAt: "2026-09-17T10:02:30.000Z",
        checkpoint: [],
      },
    ];
    const linkedinSendLog = [
      {
        id: "send_one",
        at: "2026-09-17T10:00:00.000Z",
        botId: "bot_one",
        conversationId: "conversation_one",
        messageId: "message_one",
        url: "https://www.linkedin.com/in/example",
        slug: "example",
        action: "click" as const,
        label: "Send",
        key: null,
        text: null,
        kind: "message" as const,
      },
    ];

    await updateStore((store) => {
      store.conversations = [
        {
          id: "conversation_one",
          kind: "dm",
          title: "One",
          botIds: ["bot_one"],
          createdAt: "2026-09-17T09:00:00.000Z",
          updatedAt: "2026-09-17T09:00:00.000Z",
        },
        {
          id: "conversation_other",
          kind: "dm",
          title: "Other",
          botIds: ["bot_one"],
          createdAt: "2026-09-17T09:00:00.000Z",
          updatedAt: "2026-09-17T09:00:00.000Z",
        },
      ];
      store.messages = messages;
      store.pendingApprovals = approvals;
      store.linkedinSendLog = linkedinSendLog;
    });
    return { messages, approvals, linkedinSendLog };
  }

  it("archives and removes only the selected conversation data", async () => {
    const expected = await arrange();
    const { mutate } = await import("@/lib/mutate");
    const { getStore } = await import("@/lib/store");

    const result = await mutate({ op: "clearConversation", id: "conversation_one" });
    if (!("archivePath" in result)) throw new Error("Missing archive path.");
    const store = await getStore();
    const archive = JSON.parse(fs.readFileSync(result.archivePath, "utf8"));

    expect(result).toMatchObject({ messages: 2, approvals: 1 });
    expect(path.dirname(result.archivePath)).toBe(path.join(dataDir, "archive"));
    expect(archive.messages).toEqual(expected.messages.slice(0, 2));
    expect(archive.pendingApprovals).toEqual(expected.approvals.slice(0, 1));
    expect(store.messages).toEqual(expected.messages.slice(2));
    expect(store.pendingApprovals).toEqual(expected.approvals.slice(1));
    expect(store.linkedinSendLog).toEqual(expected.linkedinSendLog);
    expect(stopConversation).toHaveBeenCalledOnce();
    expect(stopConversation).toHaveBeenCalledWith("conversation_one");
  });

  it("rejects an unknown conversation without writing an archive", async () => {
    await arrange();
    const { mutate } = await import("@/lib/mutate");

    await expect(
      mutate({ op: "clearConversation", id: "missing" })
    ).rejects.toThrow("Conversation not found.");
    expect(fs.existsSync(path.join(dataDir, "archive"))).toBe(false);
  });
});
