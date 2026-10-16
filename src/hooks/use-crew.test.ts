// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrap, sendChat } from "@/lib/client";
import { createSeedStore } from "@/lib/seed";
import { useCrew } from "@/hooks/use-crew";

vi.mock("@/lib/client", () => ({
  bootstrap: vi.fn(),
  mutate: vi.fn(),
  sendChat: vi.fn(),
  decideApproval: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/lib/paths", () => ({
  DEFAULT_COMPUTER_ROOT: "/tmp/crew-computer",
}));

describe("useCrew send", () => {
  beforeEach(() => {
    vi.mocked(bootstrap).mockResolvedValue({ store: createSeedStore(), tree: [] });
  });

  it("refuses a concurrent send and reports when the active send completes", async () => {
    let finishSend!: () => void;
    vi.mocked(sendChat).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishSend = resolve; })
    );
    const { result } = renderHook(() => useCrew());
    await waitFor(() => expect(result.current.conversationId).not.toBeNull());

    let firstSend!: Promise<boolean>;
    act(() => {
      firstSend = result.current.send("hello");
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    await expect(result.current.send("world")).resolves.toBe(false);
    expect(sendChat).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSend();
      await firstSend;
    });
    await expect(firstSend).resolves.toBe(true);
  });
});
