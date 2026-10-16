import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OutboxPane } from "@/components/crew/outbox-pane";
import type { OutboxItem, Store } from "@/lib/types";

describe("OutboxPane invite details", () => {
  it("shows the invite label and supporting research", () => {
    const item: OutboxItem = {
      id: "invite-1",
      name: "Ada Lovelace",
      profileUrl: "https://www.linkedin.com/in/ada-lovelace",
      text: "A short invitation note.",
      note: "Ada described the analytical engine. https://example.com/source",
      kind: "invite",
      status: "approved",
      createdAt: "2026-09-18T00:00:00.000Z",
      createdBy: "operator",
    };

    const html = renderToStaticMarkup(
      <OutboxPane
        store={{ outbox: [item] } as Store}
        mutateAndRefresh={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(html).toContain("Invite");
    expect(html).toContain("Research");
    expect(html).toContain(item.note!);
  });
});
