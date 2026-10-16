// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import { createSeedStore } from "@/lib/seed";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OutboxPane stopped run", () => {
  it("shows approved items waiting with the stopped reason", async () => {
    const store = createSeedStore();
    store.outbox = ["Ada", "Grace"].map((name, index) => ({
      id: `outbox-${index}`,
      name,
      profileUrl: `https://www.linkedin.com/in/${name.toLowerCase()}`,
      text: `Hello ${name}`,
      status: "approved" as const,
      createdBy: "operator",
      createdAt: "2026-10-10T10:00:00.000Z",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        active: false,
        stopRequested: false,
        nextAt: null,
        reason: "Stopped after a failure.",
        stalled: null,
      }),
    })));

    render(
      <OutboxPane
        store={store}
        mutateAndRefresh={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(await screen.findByText(
      "Not sending: 2 approved items are waiting. Stopped after a failure."
    )).toBeTruthy();
  });
});
