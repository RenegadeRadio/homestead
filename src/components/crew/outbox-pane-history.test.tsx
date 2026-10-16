// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import { createSeedStore } from "@/lib/seed";
import type { OutboxItem } from "@/lib/types";

afterEach(cleanup);

function item(status: OutboxItem["status"], createdAt: string, sentAt?: string): OutboxItem {
  return {
    id: `${status}-item`,
    name: `${status} contact`,
    profileUrl: `https://www.linkedin.com/in/${status}-contact`,
    text: `Message for ${status}`,
    status,
    createdAt,
    createdBy: "operator",
    ...(sentAt ? { sentAt } : {}),
  };
}

function renderPane() {
  const store = createSeedStore();
  store.outbox = [
    item("draft", "2026-09-30T06:00:00.000Z"),
    item("approved", "2026-09-30T07:00:00.000Z"),
    item("sending", "2026-09-30T08:00:00.000Z"),
    item("sent", "2026-09-30T09:00:00.000Z", "2026-10-02T09:00:00.000Z"),
    item("failed", "2026-09-28T09:00:00.000Z"),
    item("rejected", "2026-10-01T09:00:00.000Z"),
  ];
  const mutateAndRefresh = vi.fn().mockResolvedValue({});
  render(<OutboxPane store={store} mutateAndRefresh={mutateAndRefresh} onSend={vi.fn()} />);
  return { mutateAndRefresh };
}

describe("OutboxPane history", () => {
  it("shows only queued items on first render", () => {
    renderPane();

    expect(screen.getByText("draft contact")).toBeTruthy();
    expect(screen.getByText("approved contact")).toBeTruthy();
    expect(screen.getByText("sending contact")).toBeTruthy();
    expect(screen.queryByText("sent contact")).toBeNull();
    expect(screen.queryByText("failed contact")).toBeNull();
    expect(screen.queryByText("rejected contact")).toBeNull();
  });

  it("shows failed items first and only historical items in History", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));

    expect(screen.queryByText("draft contact")).toBeNull();
    expect(screen.queryByText("approved contact")).toBeNull();
    expect(screen.queryByText("sending contact")).toBeNull();
    expect(screen.getByText("sent contact")).toBeTruthy();
    expect(screen.getByText("failed contact")).toBeTruthy();
    expect(screen.getByText("rejected contact")).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["failed contact", "sent contact", "rejected contact", "X replies"]);
  });

  it("labels failures for checking and switches views without mutating", () => {
    const { mutateAndRefresh } = renderPane();
    const outboxButton = screen.getByRole("button", { name: "Outbox (3)" });
    const historyButton = screen.getByRole("button", { name: "History (3 · 1 to check)" });

    expect(outboxButton.getAttribute("aria-pressed")).toBe("true");
    expect(historyButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(historyButton);
    expect(historyButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(outboxButton);
    expect(outboxButton.getAttribute("aria-pressed")).toBe("true");
    expect(mutateAndRefresh).not.toHaveBeenCalled();
  });
});
