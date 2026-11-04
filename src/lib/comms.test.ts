import { afterEach, describe, expect, it, vi } from "vitest";

import { actOnCommsDraft, CommsError, listCommsDrafts, readCommsConfig } from "@/lib/comms";

const config = { url: "http://127.0.0.1:8000", token: "approve-token" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("readCommsConfig", () => {
  it("needs both a URL and a token", () => {
    expect(readCommsConfig({})).toBeNull();
    expect(readCommsConfig({ COMMS_AGENT_URL: "http://x" })).toBeNull();
    expect(readCommsConfig({ COMMS_AGENT_URL: "ftp://x", COMMS_AGENT_APPROVE_TOKEN: "t" })).toBeNull();
    expect(readCommsConfig({ COMMS_AGENT_URL: "http://x:8000/", COMMS_AGENT_APPROVE_TOKEN: " t " })).toEqual({
      url: "http://x:8000",
      token: "t",
    });
  });
});

describe("comms client", () => {
  it("lists drafts with the bearer token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ drafts: [{ id: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listCommsDrafts(config)).resolves.toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/v1/drafts?status=pending");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer approve-token");
  });

  it("sends edited text and reports the agent's result", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, message: "✅ sent", draft: { id: 4 } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await actOnCommsDraft(config, 4, "send", { text: "Thursday works" });
    expect(result).toEqual({ ok: true, message: "✅ sent", draft: { id: 4 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/v1/drafts/4/send");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Thursday works" });
  });

  it("rejects bad ids and empty redo instructions without calling the agent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(actOnCommsDraft(config, 0, "skip")).rejects.toThrow("Invalid draft id.");
    await expect(actOnCommsDraft(config, 2, "redo", { guidance: "  " })).rejects.toThrow("Say how to redraft it.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a rejected token and an unreachable agent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "Invalid or missing API token" }, 401)));
    await expect(listCommsDrafts(config)).rejects.toThrow("COMMS_AGENT_APPROVE_TOKEN");

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const error = await listCommsDrafts(config).catch((e) => e);
    expect(error).toBeInstanceOf(CommsError);
    expect(error.message).toContain("Could not reach the comms agent");
  });
});
