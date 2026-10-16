// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import type { MutateOp } from "@/lib/ops";
import type { Store } from "@/lib/types";

afterEach(cleanup);

function renderPane(mutateAndRefresh: (op: MutateOp) => Promise<unknown>) {
  render(
    <OutboxPane
      store={{ outbox: [] } as unknown as Store}
      mutateAndRefresh={mutateAndRefresh}
      onSend={vi.fn()}
    />
  );
}

function parse(markdown: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Playbook note" }), {
    target: { value: markdown },
  });
  fireEvent.click(screen.getByRole("button", { name: "Parse note" }));
}

describe("OutboxPane playbook import", () => {
  it("creates only drafts with a supplied profile URL", async () => {
    const mutateAndRefresh = vi.fn().mockResolvedValue({});
    renderPane(mutateAndRefresh);
    parse(`### Katherine Johnson · Lane A
> Hello Katherine,
> this is one message.

### Ada Lovelace · Lane B
> Hello Ada.`);

    fireEvent.change(screen.getByRole("textbox", { name: "Profile URL for Katherine Johnson" }), {
      target: { value: "https://www.linkedin.com/in/katherine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add drafts" }));

    await waitFor(() => expect(mutateAndRefresh).toHaveBeenCalledOnce());
    expect(mutateAndRefresh).toHaveBeenCalledWith({
      op: "createOutboxItem",
      name: "Katherine Johnson",
      profileUrl: "https://www.linkedin.com/in/katherine",
      text: "Hello Katherine, this is one message.",
      note: undefined,
      lane: "A",
    });
    expect(screen.getByRole("textbox", { name: "Profile URL for Ada Lovelace" })).toBeTruthy();
  });

  it("keeps a refused creation visible while creating the other draft", async () => {
    const mutateAndRefresh = vi.fn(async (op: MutateOp) => {
      if (op.op === "createOutboxItem" && op.name === "Blocked Person") {
        throw new Error("Draft contains a banned phrase.");
      }
      return {};
    });
    renderPane(mutateAndRefresh);
    parse(`### Blocked Person
> This draft is refused.

### Accepted Person
> This draft is accepted.`);

    fireEvent.change(screen.getByRole("textbox", { name: "Profile URL for Blocked Person" }), {
      target: { value: "https://www.linkedin.com/in/blocked" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Profile URL for Accepted Person" }), {
      target: { value: "https://www.linkedin.com/in/accepted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add drafts" }));

    await waitFor(() => expect(screen.getByText("Draft contains a banned phrase.")).toBeTruthy());
    expect(mutateAndRefresh).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "Profile URL for Blocked Person" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Profile URL for Accepted Person" })).toBeNull();
  });

  it("shows refused playbook headings without rendering a profile URL box", () => {
    const mutateAndRefresh = vi.fn().mockResolvedValue({});
    renderPane(mutateAndRefresh);
    parse(`### Ada Lovelace · Lane B
> Hello Ada.

### John Napier · ⛔ DO NOT SEND
> This must not be imported.`);

    expect(screen.getByText("John Napier")).toBeTruthy();
    expect(screen.getByText(/Marked do not send\./)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Profile URL for John Napier" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Profile URL for Ada Lovelace" })).toBeTruthy();
  });
});
