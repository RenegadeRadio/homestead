import { describe, expect, it } from "vitest";
import { guardLocalRequest } from "@/lib/local-request";

function request(method: string, headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:43177/api/x", { method, headers });
}

describe("guardLocalRequest", () => {
  it.each([
    ["rejects a foreign origin", "POST", {
      Host: "127.0.0.1:43177",
      Origin: "https://attacker.example",
      "Content-Type": "text/plain",
    }],
    ["rejects a foreign host", "GET", { Host: "attacker.example:43177" }],
    ["rejects a cross-site fetch", "GET", {
      Host: "127.0.0.1:43177",
      "Sec-Fetch-Site": "cross-site",
    }],
  ])("%s", async (_name, method, headers) => {
    const response = guardLocalRequest(request(method, headers));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: expect.any(String) });
  });

  it.each([
    ["a matching origin", "POST", {
      Host: "127.0.0.1:43177",
      Origin: "http://127.0.0.1:43177",
    }],
    ["a headerless local script", "POST", { Host: "localhost:43177" }],
    ["a same-origin fetch", "GET", {
      Host: "127.0.0.1:43177",
      "Sec-Fetch-Site": "same-origin",
    }],
    ["a direct browser navigation", "GET", {
      Host: "127.0.0.1:43177",
      "Sec-Fetch-Site": "none",
    }],
  ])("allows %s", (_name, method, headers) => {
    expect(guardLocalRequest(request(method, headers))).toBeNull();
  });
});
