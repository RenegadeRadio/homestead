import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/comms/route";

function request(method: "GET" | "POST", body?: unknown, origin = "http://127.0.0.1:43177") {
  return new Request("http://127.0.0.1:43177/api/comms", {
    method,
    headers: { Host: "127.0.0.1:43177", Origin: origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/comms", () => {
  beforeEach(() => {
    vi.stubEnv("COMMS_AGENT_URL", "http://127.0.0.1:8000");
    vi.stubEnv("COMMS_AGENT_APPROVE_TOKEN", "approve-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports when the agent is not configured", async () => {
    vi.stubEnv("COMMS_AGENT_URL", "");
    const response = await GET(request("GET"));
    await expect(response.json()).resolves.toEqual({ configured: false, drafts: [], recent: [] });
  });

  it("returns pending and recent drafts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      Response.json({ drafts: url.includes("pending") ? [{ id: 1 }] : [{ id: 0 }] })
    ));
    const response = await GET(request("GET"));
    await expect(response.json()).resolves.toEqual({ configured: true, drafts: [{ id: 1 }], recent: [{ id: 0 }] });
  });

  it("forwards an action to the agent", async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json({ ok: true, message: `Skipped #3 via ${url}` }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("POST", { id: 3, action: "skip" }));
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/drafts/3/skip");
  });

  it("rejects unknown actions and cross-site posts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request("POST", { id: 3, action: "delete" }))).status).toBe(400);
    expect((await POST(request("POST", { id: 3, action: "send" }, "https://evil.example"))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
