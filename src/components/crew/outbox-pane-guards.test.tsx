// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import type { OutboxItem, Store } from "@/lib/types";

afterEach(cleanup);

function item(patch: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "draft-1",
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "A complete draft message for Ada.",
    status: "draft",
    createdAt: "2026-09-18T00:00:00.000Z",
    createdBy: "operator",
    ...patch,
  };
}

function store(outbox: OutboxItem[]): Store {
  return { outbox } as Store;
}

function renderPane(outbox: OutboxItem[]) {
  const mutateAndRefresh = vi.fn().mockResolvedValue({});
  const onSend = vi.fn().mockResolvedValue({});
  render(
    <OutboxPane
      store={store(outbox)}
      mutateAndRefresh={mutateAndRefresh}
      onSend={onSend}
    />
  );
  return { mutateAndRefresh, onSend };
}

describe("OutboxPane guards", () => {
  it("pre-fills the edit box with the draft text", () => {
    const draft = item({ text: "Hello Ada, first draft" });
    renderPane([draft]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByRole("textbox", {
      name: `Message for ${draft.name}`,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello Ada, first draft");
  });

  it("does not offer Edit or Reject for a sent item", () => {
    renderPane([item({ status: "sent" })]);
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("does not offer Edit or Reject for a rejected item", () => {
    renderPane([item({ status: "rejected" })]);
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
