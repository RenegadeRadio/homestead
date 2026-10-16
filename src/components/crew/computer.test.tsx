// @vitest-environment jsdom

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComputerPane } from "@/components/crew/computer";
import { createSeedStore } from "@/lib/seed";

vi.mock("@/lib/client", () => ({
  loadFile: vi.fn().mockResolvedValue({ content: "" }),
  loadComputer: vi.fn().mockResolvedValue({
    tree: [],
    logs: [],
    terminal: [],
    browse: [],
  }),
}));

vi.mock("@/components/crew/live-browser", () => ({
  LiveBrowser: () => null,
}));

function Harness() {
  const [hasTakeover, setHasTakeover] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <ComputerPane
        store={createSeedStore()}
        tree={[]}
        selected={selected}
        onSelect={setSelected}
        preferTab={hasTakeover ? "browser" : undefined}
      />
      <button type="button" onClick={() => setHasTakeover((value) => !value)}>
        Toggle takeover
      </button>
    </>
  );
}

describe("ComputerPane", () => {
  it("switches to the browser for every takeover while preserving the user's tab between them", () => {
    render(<Harness />);

    const filesTab = screen.getByRole("tab", { name: "Files" });
    const browserTab = screen.getByRole("tab", { name: "Browser" });
    const toggleTakeover = screen.getByRole("button", { name: "Toggle takeover" });

    expect(filesTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(toggleTakeover);
    expect(browserTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(filesTab);
    expect(filesTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(toggleTakeover);
    expect(filesTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(toggleTakeover);
    expect(browserTab.getAttribute("aria-selected")).toBe("true");
  });
});
