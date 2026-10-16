// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

afterEach(cleanup);
const evidence = "Refused: weekly limit";

function sentItem(): OutboxItem {
  return {
    id: "outbox_hedy",
    name: "Hedy Lamarr",
    profileUrl: "https://www.linkedin.com/in/hedy-lamarr/",
    text: "Hello Hedy",
    status: "sent",
    sentAt: "2026-09-26T08:00:00.000Z",
    createdAt: "2026-09-25T08:00:00.000Z",
    createdBy: "operator",
  };
}

describe("OutboxPane operator correction", () => {
  it("submits trimmed evidence for a sent item", async () => {
    const store = createSeedStore();
    store.outbox = [sentItem()];
    const mutateAndRefresh = vi.fn().mockResolvedValue({});
    render(<OutboxPane store={store} mutateAndRefresh={mutateAndRefresh} onSend={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^History/ }));
    fireEvent.click(screen.getByRole("button", { name: "Not actually sent" }));
    const input = screen.getByLabelText("What LinkedIn shows");
    const submit = screen.getByRole("button", { name: "Return to queue" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  Refused: weekly limit  " } });
    fireEvent.click(submit);

    await waitFor(() => expect(mutateAndRefresh).toHaveBeenCalledWith({
      op: "revertOutboxItemSent",
      id: "outbox_hedy",
      evidence: "Refused: weekly limit",
    }));
  });

  it("shows correction evidence on a queued item", () => {
    const store = createSeedStore();
    const item = sentItem();
    item.status = "approved";
    delete item.sentAt;
    item.operatorCorrection = { at: "2026-09-26T12:00:00.000Z", evidence };
    store.outbox = [item];
    render(<OutboxPane store={store} mutateAndRefresh={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByText(`Returned to the queue by the operator: ${evidence}`)).toBeTruthy();
  });
});
