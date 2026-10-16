// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPane } from "@/components/crew/chat";

const baseProps = {
  store: {
    providers: [],
    bots: [],
    conversations: [],
    messages: [],
    skills: [],
    routines: [],
    plugins: [],
    settings: {},
    computerLogs: [],
    browseSnapshots: [],
    pendingApprovals: [],
    terminalSessions: [],
  },
  conversation: {
    id: "conversation_one",
    kind: "dm",
    title: "Chat",
    botIds: [],
    createdAt: "2026-09-17T09:00:00.000Z",
    updatedAt: "2026-09-17T09:00:00.000Z",
  },
  busy: false,
  onSend: vi.fn(),
  onApproval: vi.fn(),
  onOpenFile: vi.fn(),
  onStop: vi.fn(),
} as unknown as ComponentProps<typeof ChatPane>;

const userMessage = {
  id: "message_one",
  conversationId: "conversation_one",
  role: "user" as const,
  parts: [{ type: "text" as const, text: "Hello" }],
  createdAt: "2026-09-17T10:00:00.000Z",
  reactions: [],
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChatPane clear button", () => {
  it.each([
    [true, 1],
    [false, 0],
  ])("respects a %s confirmation", (confirmed, calls) => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(confirmed);
    render(<ChatPane {...baseProps} messages={[userMessage]} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalledTimes(calls);
  });

  it("does not show Clear for system-only messages", () => {
    render(
      <ChatPane
        {...baseProps}
        messages={[{ ...userMessage, role: "system" }]}
        onClear={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("disables Clear while busy", () => {
    render(
      <ChatPane
        {...baseProps}
        messages={[userMessage]}
        busy
        onClear={vi.fn()}
      />
    );

    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
