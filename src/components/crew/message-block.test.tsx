// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageBlock } from "@/components/crew/chat";
import type { Message, MessagePart, Store } from "@/lib/types";

function renderMessage(toolCount: number) {
  const store = {
    bots: [
      {
        id: "bot_atlas",
        name: "Atlas",
        job: "Chief of staff",
        emoji: "🧭",
        color: "#d6a24a",
      },
    ],
  } as Store;
  const toolParts: MessagePart[] = Array.from({ length: toolCount }, (_, index) => ({
    type: "tool",
    id: `tool_${index}`,
    name: "list_files",
    args: {},
    status: "done",
  }));
  const message: Message = {
    id: `msg_${toolCount}`,
    conversationId: "convo_atlas",
    role: "assistant",
    botId: "bot_atlas",
    parts: [{ type: "text", text: "Done" }, ...toolParts],
    createdAt: "2026-09-17T00:00:00.000Z",
    reactions: [],
  };

  render(
    <MessageBlock
      message={message}
      store={store}
      onApproval={vi.fn()}
      onOpenFile={vi.fn()}
      busy={false}
    />
  );
}

describe("MessageBlock tool count", () => {
  it("shows a plural tool count", () => {
    renderMessage(3);
    expect(screen.getByText("3 tool calls")).toBeDefined();
  });

  it("shows a singular tool count", () => {
    renderMessage(1);
    expect(screen.getByText("1 tool call")).toBeDefined();
  });
});
