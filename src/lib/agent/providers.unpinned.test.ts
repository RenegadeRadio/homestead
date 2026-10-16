import { afterEach, describe, expect, it, vi } from "vitest";

import { anthropicComplete, openaiComplete } from "@/lib/agent/providers";

describe("provider signal composition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes an already-aborted Anthropic caller signal to fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("Aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(anthropicComplete({
      baseUrl: "https://example.test",
      apiKey: "key",
      model: "model",
      messages: [],
      tools: [],
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the OpenAI timeout signal when a caller signal is supplied", async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    let captured: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      captured = init?.signal;
      return new Promise((_resolve, reject) => captured?.addEventListener(
        "abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }
      ));
    }));

    const completion = openaiComplete({
      baseUrl: "https://example.test/v1",
      apiKey: "key",
      model: "model",
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(captured).toBeDefined());
    expect(captured?.aborted).toBe(false);

    timeoutController.abort();

    expect(captured?.aborted).toBe(true);
    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(120_000);
  });
});
