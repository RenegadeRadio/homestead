// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxPane } from "@/components/crew/outbox-pane";
import type { Store } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OutboxPane X replies", () => {
  it("renders draft controls in newest-first order and invokes mutations", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const mutateAndRefresh = vi.fn().mockResolvedValue(undefined);
    const store = { outbox: [], xReplies: [
      { id: "old", postUrl: "https://x.com/old/status/1", author: "old", postExcerpt: "Older post", text: "Older reply", note: "Older note", status: "draft", createdAt: "2026-01-01T00:00:00Z", createdBy: "operator" },
      { id: "new", postUrl: "https://x.com/new/status/2", author: "new", postExcerpt: "Newest post", text: "Newest reply", note: "Evidence note", status: "draft", createdAt: "2026-01-02T00:00:00Z", createdBy: "operator" },
      { id: "posted", postUrl: "https://x.com/done/status/3", author: "done", postExcerpt: "Posted post", text: "Posted reply", status: "posted", createdAt: "2026-01-03T00:00:00Z", createdBy: "operator", postedAt: "2026-01-04T00:00:00Z" },
    ] } as unknown as Store;
    render(<OutboxPane store={store} mutateAndRefresh={mutateAndRefresh} onSend={vi.fn()} />);

    expect(screen.queryByText("Posted reply")).toBeNull();
    const articles = screen.getAllByRole("article");
    expect(articles[0].textContent).toContain("Newest reply");
    expect(articles[1].textContent).toContain("Older reply");
    const open = screen.getAllByRole("link", { name: "Open post" })[0];
    expect(open.getAttribute("href")).toBe("https://x.com/new/status/2");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("12/280")).toBeDefined();
    expect(screen.getByText("Evidence note")).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy reply" })[0]);
    expect(writeText).toHaveBeenCalledWith("Newest reply");
    fireEvent.click(screen.getAllByRole("button", { name: "Mark posted" })[0]);
    expect(mutateAndRefresh).toHaveBeenCalledWith({ op: "markXReplyPosted", id: "new" });
    fireEvent.click(screen.getAllByRole("button", { name: "Drop" })[0]);
    expect(mutateAndRefresh).toHaveBeenCalledWith({ op: "dropXReply", id: "new" });
    const section = screen.getByRole("heading", { name: "X replies" }).closest("section")!;
    expect(within(section).queryByRole("button", { name: /send|post reply/i })).toBeNull();
  });
});
