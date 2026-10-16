import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("@/lib/store", () => {
  const state: { store?: unknown } = {};
  return {
    getStore: vi.fn(async () => state.store),
    updateStore: vi.fn(async (fn: (store: unknown) => unknown) => fn(state.store)),
    persistStore: vi.fn(async () => {}),
    __setStore: (store: unknown) => {
      state.store = store;
    },
  };
});

import { buildClaudeCodeInvocation } from "@/lib/agent/claude-code";
import { resolveApproval } from "@/lib/agent/run";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { createSeedStore } from "@/lib/seed";
import * as storeModule from "@/lib/store";
import type { Provider, Store } from "@/lib/types";

const provider: Provider = {
  id: "prov_cc",
  name: "Claude Code",
  kind: "claude-code",
  baseUrl: "",
  apiKey: "",
  defaultModel: "claude-opus-4-6",
};

function buildInvocation(prompt = "hello world") {
  const store = createSeedStore();
  return buildClaudeCodeInvocation({
    bot: store.bots[0],
    provider,
    store,
    prompt,
    token: "tok",
  });
}

function createFakeChild(json: unknown) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.stdout.emit("data", JSON.stringify(json));
    child.emit("close", 0);
  });
  return child;
}

afterEach(() => {
  vi.mocked(spawn).mockReset();
});

describe("buildClaudeCodeInvocation", () => {
  it("terminates CLI options immediately before the prompt", () => {
    expect(buildInvocation().args.slice(-2)).toEqual(["--", "hello world"]);
  });

  it("uses strict MCP tools without bypassing permissions", () => {
    const { args } = buildInvocation();
    const allowedTools = args.flatMap((arg, index) =>
      arg === "--allowedTools" ? [args[index + 1]] : []
    );

    expect(args).toContain("-p");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
    expect(allowedTools.sort()).toEqual(
      TOOL_DEFINITIONS.map((tool) => `mcp__crew__${tool.name}`).sort()
    );
    expect(args).not.toContain("--bare");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args.join(" ")).not.toContain("bypassPermissions");
  });

  it("removes Anthropic credentials from the child environment", () => {
    const oldApiKey = process.env.ANTHROPIC_API_KEY;
    const oldAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      process.env.ANTHROPIC_API_KEY = "secret-key";
      process.env.ANTHROPIC_AUTH_TOKEN = "secret-token";
      const { env } = buildInvocation();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    } finally {
      if (oldApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = oldApiKey;
      if (oldAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = oldAuthToken;
    }
  });
});

describe("resolveApproval", () => {
  it("resumes the stored Claude Code session with the approved result", async () => {
    const store = createSeedStore();
    store.providers.push(provider);
    const bot = store.bots[0];
    bot.providerId = provider.id;
    const conversation = store.conversations[0];
    store.messages.push({
      id: "msg_resume",
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [],
      createdAt: "2026-09-16T00:00:00.000Z",
      reactions: [],
    });
    store.pendingApprovals.push({
      id: "appr_resume",
      conversationId: conversation.id,
      messageId: "msg_resume",
      botId: bot.id,
      toolName: "list_files",
      args: {},
      createdAt: "2026-09-16T00:00:00.000Z",
      checkpoint: [],
      resumeSessionId: "sess-prev-999",
    });
    const mockedStore = storeModule as typeof storeModule & {
      __setStore: (value: Store) => void;
    };
    mockedStore.__setStore(store);
    vi.mocked(spawn).mockImplementation(
      (() =>
        createFakeChild({ result: "Approved.", session_id: "sess-new-1" })) as unknown as typeof spawn
    );

    await resolveApproval({
      approvalId: "appr_resume",
      decision: "approved",
      emit: vi.fn(),
    });

    const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    const resumeIndex = args.indexOf("--resume");
    expect(args[resumeIndex + 1]).toBe("sess-prev-999");
    expect(args.slice(-2)[0]).toBe("--");
    expect(args.at(-1)).toContain("Approved.");
  });
});
