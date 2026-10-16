import {
  createPublicKey,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

export type AccessConfig = {
  publicHostname: string;
  teamDomain: string;
  aud: string;
};

type AccessKeyCacheEntry = {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
};

type AccessKeyCache = Map<string, AccessKeyCacheEntry>;

const ACCESS_KEY_CACHE = Symbol.for("crew.accessKeyCache");

function accessKeyCache(): AccessKeyCache {
  const globals = globalThis as typeof globalThis & {
    [ACCESS_KEY_CACHE]?: AccessKeyCache;
  };
  globals[ACCESS_KEY_CACHE] ??= new Map();
  return globals[ACCESS_KEY_CACHE];
}

export function resetAccessKeyCache(): void {
  accessKeyCache().clear();
}

export function readAccessConfig(
  env: NodeJS.ProcessEnv = process.env,
): AccessConfig | null {
  const publicHostname = env.CREW_PUBLIC_HOSTNAME?.trim().toLowerCase() ?? "";
  const teamDomain = env.CREW_ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? "";
  const aud = env.CREW_ACCESS_AUD?.trim() ?? "";

  if (!publicHostname || !teamDomain || !aud) return null;
  return { publicHostname, teamDomain, aud };
}

export function accessTokenFrom(req: Request): string | null {
  const assertion = req.headers.get("cf-access-jwt-assertion")?.trim();
  if (assertion) return assertion;

  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== "CF_Authorization") continue;
    const token = part.slice(separator + 1).trim();
    return token || null;
  }
  return null;
}

function tokenHeader(token: string): { alg?: unknown; kid?: unknown } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function loadAccessKey(
  token: string,
  config: AccessConfig,
  options: { fetchFn?: typeof fetch; nowMs?: number } = {},
): Promise<void> {
  try {
    const header = tokenHeader(token);
    if (!header || typeof header.kid !== "string") return;

    const cache = accessKeyCache();
    const entry = cache.get(config.teamDomain);
    if (entry?.keys.has(header.kid)) return;

    const nowMs = options.nowMs ?? Date.now();
    if (entry && nowMs - entry.fetchedAt < 60_000) return;

    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(
      `https://${config.teamDomain}/cdn-cgi/access/certs`,
    );
    if (!response.ok) return;

    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("keys" in body) ||
      !Array.isArray(body.keys)
    ) {
      return;
    }

    const keys = new Map<string, KeyObject>();
    for (const key of body.keys) {
      if (typeof key !== "object" || key === null || !("kid" in key)) continue;
      if (typeof key.kid !== "string") continue;
      try {
        keys.set(
          key.kid,
          createPublicKey({
            key: key as JsonWebKey,
            format: "jwk",
          }),
        );
      } catch {
        // Ignore an individual malformed key while retaining other valid keys.
      }
    }
    cache.set(config.teamDomain, { keys, fetchedAt: nowMs });
  } catch {
    // Access key loading must fail closed without disrupting request handling.
  }
}

export function verifyAccessJwtSync(
  token: string,
  config: AccessConfig,
  nowMs = Date.now(),
): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header: unknown = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8"),
    );
    if (
      typeof header !== "object" ||
      header === null ||
      !("alg" in header) ||
      header.alg !== "RS256" ||
      !("kid" in header) ||
      typeof header.kid !== "string"
    ) {
      return false;
    }

    const key = accessKeyCache().get(config.teamDomain)?.keys.get(header.kid);
    if (!key) return false;
    if (
      !verify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        key,
        Buffer.from(encodedSignature, "base64url"),
      )
    ) {
      return false;
    }

    const payload: unknown = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    if (typeof payload !== "object" || payload === null) return false;
    const claims = payload as { aud?: unknown; iss?: unknown; exp?: unknown };
    const audienceMatches =
      claims.aud === config.aud ||
      (Array.isArray(claims.aud) && claims.aud.includes(config.aud));
    return (
      audienceMatches &&
      claims.iss === `https://${config.teamDomain}` &&
      typeof claims.exp === "number" &&
      claims.exp * 1000 > nowMs
    );
  } catch {
    return false;
  }
}

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  options: { fetchFn?: typeof fetch; nowMs?: number } = {},
): Promise<boolean> {
  await loadAccessKey(token, config, options);
  return verifyAccessJwtSync(token, config, options.nowMs ?? Date.now());
}
