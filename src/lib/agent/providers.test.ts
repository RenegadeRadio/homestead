import { afterEach, describe, expect, it, vi } from "vitest";

import { openaiComplete } from "@/lib/agent/providers";

describe("provider cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes an already-aborted combined signal to fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("Aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(openaiComplete({
      baseUrl: "https://example.test/v1",
      apiKey: "key",
      model: "model",
      messages: [],
      tools: [],
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
