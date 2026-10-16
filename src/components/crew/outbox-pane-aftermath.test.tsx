// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import type { OutboxItem, Store } from "@/lib/types";

afterEach(cleanup);

function item(patch: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "item-1",
    name: "Ada Lovelace",
    profileUrl: "https://www.linkedin.com/in/ada-lovelace",
    text: "Hello Ada",
    status: "failed",
    createdAt: "2026-09-18T00:00:00.000Z",
    createdBy: "operator",
    ...patch,
  };
}

function renderPane(outbox: OutboxItem[]) {
  render(
    <OutboxPane
      store={{ outbox } as Store}
      mutateAndRefresh={vi.fn().mockResolvedValue({})}
      onSend={vi.fn().mockResolvedValue({})}
    />
  );
}

describe("OutboxPane aftermath", () => {
  it("shows when text was left in the compose box", () => {
    renderPane([
      item({
        aftermath: {
          at: "2026-09-20T10:00:00.000Z",
          composeOpen: true,
          draftLeft: true,
        },
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));

    expect(screen.getByText(/left in the compose box/i)).toBeTruthy();
  });

  it("shows nothing when no draft was left or no measurement exists", () => {
    renderPane([
      item({
        aftermath: {
          at: "2026-09-20T10:00:00.000Z",
          composeOpen: true,
          draftLeft: false,
        },
      }),
      item({ id: "item-2", name: "Grace Hopper" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));

    expect(screen.queryByText(/left in the compose box/i)).toBeNull();
  });
});
