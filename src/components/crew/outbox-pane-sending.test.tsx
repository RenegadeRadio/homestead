// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

afterEach(cleanup);

function item(status: OutboxItem["status"]): OutboxItem {
  return {
    id: "outbox_ada",
    name: "Ada",
    profileUrl: "https://www.linkedin.com/in/ada",
    text: "Hello Ada",
    status,
    createdAt: "2026-09-18T10:00:00.000Z",
    createdBy: "operator",
  };
}

describe("OutboxPane sending state", () => {
  it("only offers Mark failed for a sending item", () => {
    const store = createSeedStore();
    store.outbox = [item("sending")];
    const mutateAndRefresh = vi.fn().mockResolvedValue({});
    render(<OutboxPane store={store} mutateAndRefresh={mutateAndRefresh} onSend={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark failed" }));
    expect(mutateAndRefresh).toHaveBeenCalledWith({ op: "failOutboxItem", id: "outbox_ada" });
  });

  it("shows the reason returned by onSend", async () => {
    const store = createSeedStore();
    store.outbox = [item("approved")];
    const onSend = vi.fn().mockResolvedValue({ started: false, reason: "No approved items." });
    render(<OutboxPane store={store} mutateAndRefresh={vi.fn()} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: "Send approved (1)" }));

    await waitFor(() => expect(screen.getByText("No approved items.")).toBeTruthy());
  });
});
