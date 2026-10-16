import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser")>();
  return {
    ...actual,
    ensureBrowser: vi.fn(),
    humanNavigate: vi.fn(),
    browserNavigate: vi.fn(),
    browserStatus: vi.fn(),
  };
});

import { POST } from "@/app/api/browser/route";
import {
  browserNavigate,
  browserStatus,
  ensureBrowser,
  humanNavigate,
} from "@/lib/browser";

function request(body: Record<string, unknown>) {
  return new Request("http://127.0.0.1:43177/api/browser", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:43177",
      Origin: "http://127.0.0.1:43177",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/browser operator navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browserStatus).mockResolvedValue({
      running: true,
      mode: "human",
      url: "https://linkedin.com/login",
      title: "LinkedIn",
      takeoverReason: "Sign in",
      width: 1280,
      height: 800,
    });
  });

  it("uses human navigation for navigate", async () => {
    const response = await POST(request({ action: "navigate", url: "linkedin.com/login" }));

    expect(response.status).toBe(200);
    expect(humanNavigate).toHaveBeenCalledWith("linkedin.com/login");
    expect(browserNavigate).not.toHaveBeenCalled();
  });

  it("uses human navigation for start with a URL", async () => {
    const response = await POST(request({ action: "start", url: "linkedin.com/login" }));

    expect(response.status).toBe(200);
    expect(ensureBrowser).toHaveBeenCalledOnce();
    expect(humanNavigate).toHaveBeenCalledWith("linkedin.com/login");
    expect(browserNavigate).not.toHaveBeenCalled();
  });
});
