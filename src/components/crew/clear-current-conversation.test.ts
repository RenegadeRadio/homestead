import { describe, expect, it, vi } from "vitest";

import { clearCurrentConversation } from "@/components/crew/crew-app";

describe("clearCurrentConversation", () => {
  it("clears the selected conversation and reports success", async () => {
    const runMutate = vi.fn().mockResolvedValue(undefined);
    const notify = { success: vi.fn(), error: vi.fn() };

    await clearCurrentConversation("convo_desk", runMutate, notify);

    expect(runMutate).toHaveBeenCalledOnce();
    expect(runMutate).toHaveBeenCalledWith({
      op: "clearConversation",
      id: "convo_desk",
    });
    expect(notify.success).toHaveBeenCalledOnce();
    expect(notify.success).toHaveBeenCalledWith("Chat cleared. A copy was saved.");
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("does nothing without a conversation id", async () => {
    const runMutate = vi.fn().mockResolvedValue(undefined);
    const notify = { success: vi.fn(), error: vi.fn() };

    await clearCurrentConversation(null, runMutate, notify);

    expect(runMutate).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("reports mutation errors without rejecting", async () => {
    const runMutate = vi.fn().mockRejectedValue(new Error("Conversation not found."));
    const notify = { success: vi.fn(), error: vi.fn() };

    await expect(
      clearCurrentConversation("convo_desk", runMutate, notify)
    ).resolves.toBeUndefined();

    expect(notify.error).toHaveBeenCalledOnce();
    expect(notify.error).toHaveBeenCalledWith(
      "Could not clear the chat: Conversation not found."
    );
    expect(notify.success).not.toHaveBeenCalled();
  });
});
