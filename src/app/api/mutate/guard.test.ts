import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mutate", () => ({ mutate: vi.fn() }));

import { mutate } from "@/lib/mutate";
import { POST } from "@/app/api/mutate/route";

describe("POST /api/mutate request guard", () => {
  it("rejects a foreign origin before mutating", async () => {
    const req = new Request("http://127.0.0.1:43177/api/mutate", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:43177",
        Origin: "https://attacker.example",
        "Content-Type": "text/plain",
      },
      body: "not parsed",
    });

    const response = await POST(req);

    expect(response.status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });
});
