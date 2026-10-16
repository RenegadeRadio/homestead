// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

afterEach(cleanup);

function item(status: OutboxItem["status"]): OutboxItem {
  return {
    id: "outbox_hedy",
    name: "Hedy Lamarr",
    profileUrl: "https://www.linkedin.com/in/hedy-lamarr/",
    text: "Hello Hedy",
    status,
    createdAt: "2026-09-25T08:00:00.000Z",
    createdBy: "operator",
  };
}

describe("OutboxPane operator confirmation", () => {
  it("submits trimmed evidence for a sending item", async () => {
    const store = createSeedStore();
    store.outbox = [item("sending")];
    const mutateAndRefresh = vi.fn().mockResolvedValue({});
    render(<OutboxPane store={store} mutateAndRefresh={mutateAndRefresh} onSend={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm sent" }));
    const input = screen.getByLabelText("Seen on LinkedIn");
    const submit = screen.getByRole("button", { name: "Record as sent" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  Seen in Sent invitations  " } });
    fireEvent.click(submit);

    await waitFor(() => expect(mutateAndRefresh).toHaveBeenCalledWith({
      op: "confirmOutboxItemSent",
      id: "outbox_hedy",
      evidence: "Seen in Sent invitations",
    }));
  });

  it("shows confirmation evidence on a sent item", () => {
    const store = createSeedStore();
    const sent = item("sent");
    sent.operatorConfirmation = { at: "2026-09-25T09:00:00.000Z", evidence: "Seen in Sent invitations" };
    store.outbox = [sent];
    render(<OutboxPane store={store} mutateAndRefresh={vi.fn()} onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));
    expect(screen.getByText("Confirmed by the operator: Seen in Sent invitations")).toBeTruthy();
  });
});
