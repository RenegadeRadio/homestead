// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "@/components/crew/chat";

afterEach(cleanup);

function renderComposer(onSend: ComponentProps<typeof Composer>["onSend"]) {
  const view = render(
    <Composer
      members={[]}
      skills={[]}
      busy={false}
      onSend={onSend}
      onStop={() => {}}
      group={false}
    />
  );
  return {
    container: view.container,
    textarea: screen.getByPlaceholderText("Give them a finish line…") as HTMLTextAreaElement,
  };
}

function submit(textarea: HTMLTextAreaElement) {
  fireEvent.change(textarea, { target: { value: "hello" } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

function attachFile(container: HTMLElement, name: string) {
  const file = new File(["x"], name, { type: "text/plain" });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByText(name)).toBeTruthy();
  return file;
}

describe("Composer pending send", () => {
  it("passes an attached file to onSend and clears it while sending", async () => {
    const onSend = vi.fn(() => new Promise<void>(() => {}));
    const { container, textarea } = renderComposer(onSend);
    const file = attachFile(container, "notes.txt");

    submit(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend).toHaveBeenCalledWith("hello", {
      mentions: [],
      skillId: undefined,
      files: [file],
    });
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("restores an attached file when the send is refused", async () => {
    let resolveSend!: (sent: false) => void;
    const onSend = vi.fn(
      () => new Promise<false>((resolve) => { resolveSend = resolve; })
    );
    const { container, textarea } = renderComposer(onSend);
    attachFile(container, "notes.txt");

    submit(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(screen.queryByText("notes.txt")).toBeNull();

    await act(async () => {
      resolveSend(false);
    });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeTruthy());
  });

  it("does not overwrite text typed while a refused send is pending", async () => {
    let resolveSend!: (sent: false) => void;
    const onSend = vi.fn(
      () => new Promise<false>((resolve) => { resolveSend = resolve; })
    );
    const { textarea } = renderComposer(onSend);

    submit(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    await waitFor(() => expect(textarea.value).toBe(""));
    fireEvent.change(textarea, { target: { value: "second" } });

    await act(async () => {
      resolveSend(false);
    });
    await waitFor(() => expect(textarea.value).toBe("second"));
  });
});
