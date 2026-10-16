import { NextResponse, type NextRequest } from "next/server";
import { accessTokenFrom, loadAccessKey, readAccessConfig } from "@/lib/access-jwt";
import { guardLocalRequest, isLocalHostname } from "@/lib/local-request";

export async function proxy(request: NextRequest) {
  const config = readAccessConfig();
  if (config === null) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":", 1)[0];

  if (isLocalHostname(hostname)) {
    if (
      request.headers.has("cf-ray") ||
      request.headers.has("cf-connecting-ip")
    ) {
      return guardLocalRequest(request) ?? NextResponse.next();
    }
    return NextResponse.next();
  }

  if (hostname.toLowerCase() === config.publicHostname) {
    const token = accessTokenFrom(request);
    if (token) await loadAccessKey(token, config);
  }

  return guardLocalRequest(request) ?? NextResponse.next();
}
