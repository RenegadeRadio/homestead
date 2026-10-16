// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "@/components/crew/chat";

afterEach(cleanup);

function renderComposer(onSend: ComponentProps<typeof Composer>["onSend"], busy = false) {
  render(
    <Composer
      members={[]}
      skills={[]}
      busy={busy}
      onSend={onSend}
      onStop={() => {}}
      group={false}
    />
  );
  return screen.getByPlaceholderText("Give them a finish line…") as HTMLTextAreaElement;
}

function submit(textarea: HTMLTextAreaElement) {
  fireEvent.change(textarea, { target: { value: "hello" } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("Composer", () => {
  it("clears an accepted draft before the send finishes", async () => {
    const onSend = vi.fn(() => new Promise<void>(() => {}));
    const textarea = renderComposer(onSend);

    submit(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend).toHaveBeenCalledWith("hello", {
      mentions: [],
      skillId: undefined,
      files: [],
    });
    expect(textarea.value).toBe("");
  });

  it("keeps the draft and explains why sending is blocked while busy", () => {
    const onSend = vi.fn(() => Promise.resolve());
    const textarea = renderComposer(onSend, true);

    submit(textarea);

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("hello");
    expect(screen.getByText("Wait for the Bot to finish, or press Stop.")).toBeTruthy();
  });

  it("restores a refused draft", async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    const textarea = renderComposer(onSend);

    submit(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    await waitFor(() => expect(textarea.value).toBe("hello"));
  });

  it("leaves an accepted draft empty", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const textarea = renderComposer(onSend);

    submit(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    await waitFor(() => expect(textarea.value).toBe(""));
  });
});
