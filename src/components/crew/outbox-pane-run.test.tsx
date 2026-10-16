// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import { createSeedStore } from "@/lib/seed";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OutboxPane run controls", () => {
  it("shows and posts the stop control for an active run", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ active: true, stopRequested: false, nextAt: null, reason: "" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ active: true, stopRequested: true, nextAt: null, reason: "" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OutboxPane
        store={createSeedStore()}
        mutateAndRefresh={vi.fn()}
        onSend={vi.fn()}
      />
    );

    const stop = await screen.findByRole("button", { name: "Stop sending" });
    fireEvent.click(stop);
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/outbox/run",
      { method: "POST" }
    ));
  });
});
