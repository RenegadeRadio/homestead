// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommsPane } from "@/components/crew/comms-pane";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draft = {
  id: 7,
  channel: "whatsapp",
  status: "pending",
  category: "urgent",
  summary: "Asks about lunch",
  text: "Thursday works!",
  note: "",
  error: "",
  counterpart: "27821234567",
  counterpart_name: "Jane",
  subject: "",
  created_at: 0,
  incoming: "Lunch Thursday?",
};

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("CommsPane", () => {
  it("explains how to connect when not configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ configured: false, drafts: [], recent: [] })));
    render(<CommsPane />);
    expect(await screen.findByText(/isn.t connected/)).toBeTruthy();
  });

  it("sends the edited reply", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ configured: true, drafts: [draft], recent: [] }))
      .mockResolvedValueOnce(ok({ ok: true, message: "✅ #7 sent to Jane." }))
      .mockResolvedValue(ok({ configured: true, drafts: [], recent: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CommsPane />);

    const box = await screen.findByLabelText("Reply to Jane");
    expect(screen.getByText("Urgent")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Thursday's perfect" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/comms", expect.objectContaining({ method: "POST" })));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ id: 7, action: "send", text: "Thursday's perfect" });
    expect(await screen.findByText("✅ #7 sent to Jane.")).toBeTruthy();
    expect(await screen.findByText("Nothing waiting on you.")).toBeTruthy();
  });

  it("only allows Redo with an instruction", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ configured: true, drafts: [draft], recent: [] })));
    render(<CommsPane />);
    const redo = await screen.findByRole("button", { name: "Redo" });
    expect((redo as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Redraft instruction for Jane"), { target: { value: "say no" } });
    expect((redo as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("CommsPane redo", () => {
  it("shows the new draft straight away", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ configured: true, drafts: [draft], recent: [] }))
      .mockResolvedValueOnce(ok({ ok: true, message: "long WhatsApp text", draft: { ...draft, text: "Sorry, can't make it" } }))
      .mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<CommsPane />);

    fireEvent.change(await screen.findByLabelText("Redraft instruction for Jane"), { target: { value: "decline" } });
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    expect(await screen.findByText("Redrafted #7.")).toBeTruthy();
    expect((screen.getByLabelText("Reply to Jane") as HTMLTextAreaElement).value).toBe("Sorry, can't make it");
  });
});
