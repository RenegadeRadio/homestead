// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxPane } from "@/components/crew/outbox-pane";
import type { Store } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OutboxPane X reply expiry", () => {
  it("shows fresh post age, expires old posts, and keeps drafts without postAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const base = {
      status: "draft" as const,
      createdAt: "2026-10-08T11:00:00.000Z",
      createdBy: "operator" as const,
      postExcerpt: "Post",
      note: undefined,
    };
    const store = {
      settings: {},
      outbox: [],
      xReplies: [
        { ...base, id: "fresh", postUrl: "https://x.com/fresh/status/1", author: "fresh", text: "Fresh reply", postAt: "2026-10-08T09:59:00.000Z" },
        { ...base, id: "old", postUrl: "https://x.com/old/status/2", author: "old", text: "Expired reply", postAt: "2026-10-07T17:00:00.000Z" },
        { ...base, id: "legacy", postUrl: "https://x.com/legacy/status/3", author: "legacy", text: "No timestamp reply" },
      ],
    } as unknown as Store;

    render(<OutboxPane store={store} mutateAndRefresh={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByText("posted 2 h ago")).toBeDefined();
    expect(screen.getByText("Fresh reply")).toBeDefined();
    expect(screen.queryByText("Expired reply")).toBeNull();
    expect(screen.getByText("No timestamp reply")).toBeDefined();
  });
});
