import {
  accessTokenFrom,
  readAccessConfig,
  verifyAccessJwtSync,
} from "@/lib/access-jwt";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname);
}

function forbidden(error: string): Response {
  return Response.json({ error }, { status: 403 });
}

export function guardLocalRequest(req: Request): Response | null {
  const host = req.headers.get("host") ?? "";
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":", 1)[0];

  const config = readAccessConfig();
  const publicConfig =
    config !== null && hostname.toLowerCase() === config.publicHostname
      ? config
      : null;

  if (publicConfig !== null) {
    const token = accessTokenFrom(req);
    if (!token || !verifyAccessJwtSync(token, publicConfig)) {
      return forbidden("A valid Cloudflare Access token is required.");
    }
  } else if (!isLocalHostname(hostname)) {
    return forbidden("Requests must use a local Host header.");
  } else if (
    config !== null &&
    (req.headers.has("cf-ray") || req.headers.has("cf-connecting-ip"))
  ) {
    return forbidden("A request from the tunnel must use the public Host header.");
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return forbidden("Cross-site requests are not allowed.");
  }

  const method = req.method.toUpperCase();
  const origin = req.headers.get("origin");
  const expectedOrigin = publicConfig !== null
    ? `https://${publicConfig.publicHostname}`
    : `http://${host}`;
  if (method !== "GET" && method !== "HEAD" && origin !== null && origin !== expectedOrigin) {
    return forbidden("Request Origin does not match its Host.");
  }

  return null;
}
