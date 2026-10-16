// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("OutboxPane", () => {
  it("shows a draft recipient, full text, and profile link", () => {
    const draft = item();
    renderPane([draft]);

    expect(screen.getByText(draft.name)).toBeTruthy();
    expect(screen.getByText(draft.text)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(draft.profileUrl);
  });

  it("approves a draft item in the Outbox view", () => {
    const draft = item();
    const failed = item({ id: "failed-1", name: "Grace Hopper", status: "failed" });
    const { mutateAndRefresh } = renderPane([draft, failed]);
    const card = screen.getByRole("article");

    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(mutateAndRefresh).toHaveBeenCalledWith({ op: "approveOutboxItems", ids: [draft.id] });
  });

  it("offers Approve on a failed item in the History view", () => {
    const draft = item();
    const failed = item({ id: "failed-1", name: "Grace Hopper", status: "failed" });
    renderPane([draft, failed]);

    fireEvent.click(screen.getByRole("button", { name: /^History/ }));
    expect(within(screen.getByRole("article")).getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("saves edited text", async () => {
    const draft = item();
    const { mutateAndRefresh } = renderPane([draft]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: `Message for ${draft.name}` }), {
      target: { value: "Updated message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutateAndRefresh).toHaveBeenCalledWith({
        op: "updateOutboxItem",
        id: draft.id,
        text: "Updated message",
      })
    );
  });

  it("rejects a draft", () => {
    const draft = item();
    const { mutateAndRefresh } = renderPane([draft]);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutateAndRefresh).toHaveBeenCalledWith({ op: "rejectOutboxItem", id: draft.id });
  });

  it("only enables sending when approved items exist", () => {
    const empty = renderPane([item()]);
    expect((screen.getByRole("button", { name: "Send approved (0)" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const approved = renderPane([
      item({ id: "approved-1", status: "approved" }),
      item({ id: "approved-2", status: "approved" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Send approved (2)" }));
    expect(approved.onSend).toHaveBeenCalledOnce();
    expect(empty.onSend).not.toHaveBeenCalled();
  });

  it("shows a failed item's error", () => {
    renderPane([item({ status: "failed", error: "LinkedIn session expired." })]);
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));
    expect(screen.getByText("LinkedIn session expired.")).toBeTruthy();
  });
});
