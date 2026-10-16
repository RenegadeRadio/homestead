import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as bootstrap } from "@/app/api/bootstrap/route";
import {
  loadAccessKey,
  readAccessConfig,
  resetAccessKeyCache,
  verifyAccessJwt,
} from "@/lib/access-jwt";
import { guardLocalRequest } from "@/lib/local-request";
import { proxy } from "@/proxy";

const PUBLIC_HOST = "crew.example.com";
const TEAM_DOMAIN = "example.cloudflareaccess.com";
const AUD = "crew-audience";
const NOW = Date.UTC(2026, 9, 10);

const primaryPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

function token(
  options: {
    kid?: string;
    privateKey?: KeyObject;
    aud?: string | string[];
    iss?: string;
    exp?: number;
  } = {},
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: options.kid ?? "primary" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: options.aud ?? AUD,
      iss: options.iss ?? `https://${TEAM_DOMAIN}`,
      exp: options.exp ?? NOW / 1000 + 3600,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    options.privateKey ?? primaryPair.privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function request(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`https://${PUBLIC_HOST}${path}`, {
    method: options.method,
    headers: { Host: PUBLIC_HOST, ...options.headers },
  });
}

function stubConfig(): void {
  vi.stubEnv("CREW_PUBLIC_HOSTNAME", ` ${PUBLIC_HOST.toUpperCase()} `);
  vi.stubEnv("CREW_ACCESS_TEAM_DOMAIN", ` ${TEAM_DOMAIN.toUpperCase()} `);
  vi.stubEnv("CREW_ACCESS_AUD", ` ${AUD} `);
}

function stubCerts() {
  const jwk = primaryPair.publicKey.export({ format: "jwk" });
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (String(input) === `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [{ ...jwk, kid: "primary" }] });
    }
    return new Response(null, { status: 502 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function prime(value: string, nowMs = NOW): Promise<void> {
  await loadAccessKey(value, readAccessConfig()!, { nowMs });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetAccessKeyCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Cloudflare Access request protection", () => {
  it("refuses unauthenticated public page and API requests", async () => {
    stubConfig();
    stubCerts();

    expect((await proxy(request("/"))).status).toBe(403);
    expect(await bootstrap(request("/api/bootstrap"))).toMatchObject({ status: 403 });
  });

  it("refuses every invalid token at the proxy and synchronous guard", async () => {
    stubConfig();
    stubCerts();
    await prime(token());

    const tampered = token().split(".");
    tampered[2] = `${tampered[2].slice(0, -2)}aa`;
    const invalid = [
      token({ privateKey: otherPair.privateKey }),
      tampered.join("."),
      token({ aud: ["other-audience"] }),
      token({ iss: "https://other.cloudflareaccess.com" }),
      token({ exp: NOW / 1000 - 1 }),
    ];

    for (const value of invalid) {
      const headers = { "Cf-Access-Jwt-Assertion": value };
      expect((await proxy(request("/", { headers }))).status).toBe(403);
      expect(
        guardLocalRequest(
          request("/api/mutate", {
            method: "POST",
            headers: { ...headers, Origin: `https://${PUBLIC_HOST}` },
          }),
        )?.status,
      ).toBe(403);
    }
  });

  it("accepts valid header and cookie tokens and requires an HTTPS origin", async () => {
    stubConfig();
    stubCerts();
    const value = token();

    const headerResponse = await proxy(
      request("/", { headers: { "Cf-Access-Jwt-Assertion": value } }),
    );
    expect(headerResponse.headers.get("x-middleware-next")).toBe("1");

    const cookieResponse = await proxy(
      request("/", { headers: { Cookie: `CF_Authorization=${value}` } }),
    );
    expect(cookieResponse.headers.get("x-middleware-next")).toBe("1");

    const validPost = request("/api/mutate", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": value,
        Origin: `https://${PUBLIC_HOST}`,
      },
    });
    expect(guardLocalRequest(validPost)).toBeNull();
    validPost.headers.set("origin", `http://${PUBLIC_HOST}`);
    expect(guardLocalRequest(validPost)?.status).toBe(403);
  });

  it("caches known keys and refreshes an unknown kid after 60 seconds", async () => {
    stubConfig();
    const fetchMock = stubCerts();
    const value = token();
    const config = readAccessConfig()!;

    expect(await verifyAccessJwt(value, config, { nowMs: NOW })).toBe(true);
    expect(await verifyAccessJwt(value, config, { nowMs: NOW + 1_000 })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(
      await verifyAccessJwt(token({ kid: "unknown" }), config, {
        nowMs: NOW + 61_000,
      }),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps local access while refusing tunnel-marked and foreign hosts", async () => {
    stubConfig();
    stubCerts();
    const local = new NextRequest("http://127.0.0.1:43177/", {
      headers: { Host: "127.0.0.1:43177" },
    });
    expect((await proxy(local)).headers.get("x-middleware-next")).toBe("1");
    expect(
      guardLocalRequest(
        new Request("http://127.0.0.1:43177/api/mutate", {
          method: "POST",
          headers: {
            Host: "127.0.0.1:43177",
            Origin: "http://127.0.0.1:43177",
          },
        }),
      ),
    ).toBeNull();

    local.headers.set("cf-ray", "ray-id");
    expect((await proxy(local)).status).toBe(403);
    expect(
      (
        await proxy(
          new NextRequest("https://other.example/", {
            headers: { Host: "other.example" },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("preserves local-only behavior when configuration is unset", async () => {
    const fetchMock = stubCerts();
    const value = token();
    const publicRequest = request("/", {
      headers: { "Cf-Access-Jwt-Assertion": value },
    });

    expect(guardLocalRequest(publicRequest)?.status).toBe(403);
    expect(await bootstrap(request("/api/bootstrap", {
      headers: { "Cf-Access-Jwt-Assertion": value },
    }))).toMatchObject({ status: 403 });
    expect((await proxy(publicRequest)).headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
