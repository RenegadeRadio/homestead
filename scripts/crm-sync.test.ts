import { describe, expect, it, vi } from "vitest";

import { main } from "./crm-sync.mjs";

function okResponse(counts: Record<string, number>) {
  return { ok: true, status: 200, json: async () => counts };
}

describe("CRM sync command", () => {
  it("posts to the default port and honors PORT", async () => {
    const defaultFetch = vi.fn().mockResolvedValue(okResponse({ failed: 0, ambiguous: 0 }));
    await main({ env: {}, fetchFn: defaultFetch });
    expect(defaultFetch.mock.calls[0][0]).toBe("http://127.0.0.1:43177/api/crm-sync");

    const customFetch = vi.fn().mockResolvedValue(okResponse({ failed: 0, ambiguous: 0 }));
    await main({ env: { PORT: "4000" }, fetchFn: customFetch });
    expect(customFetch.mock.calls[0][0]).toBe("http://127.0.0.1:4000/api/crm-sync");
  });

  it.each([
    [{ failed: 0, ambiguous: 0, synced: 2 }, 0],
    [{ failed: 1, ambiguous: 0 }, 1],
    [{ failed: 0, ambiguous: 1 }, 1],
  ])("returns the expected exit code for %j", async (counts, exitCode) => {
    const result = await main({ env: {}, fetchFn: vi.fn().mockResolvedValue(okResponse(counts)) });
    expect(result.exitCode).toBe(exitCode);
  });

  it("returns exit code 2 when Homestead is unreachable", async () => {
    const result = await main({
      env: {},
      fetchFn: vi.fn().mockRejectedValue(new Error("refused")),
    });
    expect(result.exitCode).toBe(2);
  });
});
