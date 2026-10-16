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

describe("useCrew send failure", () => {
  beforeEach(() => {
    vi.mocked(bootstrap).mockResolvedValue({ store: createSeedStore(), tree: [] });
  });

  it("resolves false when sendChat rejects", async () => {
    vi.mocked(sendChat).mockRejectedValueOnce(new Error("Send failed."));
    const { result } = renderHook(() => useCrew());
    await waitFor(() => expect(result.current.conversationId).not.toBeNull());

    let sent!: boolean;
    await act(async () => {
      sent = await result.current.send("hello");
    });

    expect(sent).toBe(false);
  });
});
