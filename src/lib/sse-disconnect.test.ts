import { describe, expect, it } from "vitest";
import { persistEmit, sseResponse } from "@/lib/sse";
import type { CrewEvent, Message } from "@/lib/types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function message(): Message {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "assistant",
    botId: "bot-1",
    parts: [],
    createdAt: "2026-10-10T00:00:00.000Z",
    reactions: [],
  };
}

describe("sseResponse disconnects", () => {
  it("keeps persisting tool results after the client cancels", async () => {
    const release = deferred();
    const complete = deferred();
    const stored = message();
    let handlerError: unknown;
    let finished = false;

    const response = sseResponse(async (emit) => {
      const out = persistEmit(stored, emit);
      try {
        out({
          type: "tool_start",
          botId: "bot-1",
          messageId: stored.id,
          toolId: "tool-1",
          name: "shell",
          args: { command: "true" },
        });
        await release.promise;
        out({
          type: "tool_end",
          botId: "bot-1",
          messageId: stored.id,
          toolId: "tool-1",
          status: "done",
          result: "ok",
        });
        finished = true;
      } catch (error) {
        handlerError = error;
      } finally {
        complete.resolve();
      }
    });

    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    release.resolve();
    await complete.promise;

    expect(handlerError).toBeUndefined();
    expect(finished).toBe(true);
    expect(stored.parts).toContainEqual({
      type: "tool",
      id: "tool-1",
      name: "shell",
      args: { command: "true" },
      status: "done",
      result: "ok",
    });
  });

  it("resolves when the handler emits after cancellation", async () => {
    const release = deferred();
    const complete = deferred();

    const response = sseResponse(async (emit) => {
      emit({ type: "done" });
      await release.promise;
      const event: CrewEvent = {
        type: "text_delta",
        botId: "bot-1",
        messageId: "message-1",
        text: "after cancel",
      };
      emit(event);
      complete.resolve();
    });

    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    release.resolve();

    await expect(complete.promise).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
