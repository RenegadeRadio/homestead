// Server-side client for the comms agent (WhatsApp + Gmail triage, github.com/RenegadeRadio/DeepSeek-Agent).
//
// The approve token can send messages as you, so it lives only in this server's
// environment. It is never stored in data/store.json, where Bots' plugins live,
// and never reaches the browser: the Comms tab talks to /api/comms, which calls
// the agent from here.

export interface CommsDraft {
  id: number;
  channel: "gmail" | "whatsapp";
  status: string;
  category: string;
  summary: string;
  text: string;
  note: string;
  error: string;
  counterpart: string;
  counterpart_name: string;
  subject: string;
  created_at: number;
  incoming: string;
}

export type CommsAction = "send" | "skip" | "redo";

export interface CommsConfig {
  url: string;
  token: string;
}

export class CommsError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function readCommsConfig(
  env: Record<string, string | undefined> = process.env
): CommsConfig | null {
  const url = (env.COMMS_AGENT_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.COMMS_AGENT_APPROVE_TOKEN ?? "").trim();
  if (!url || !token) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, token };
}

async function call(config: CommsConfig, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${config.url}/api/v1${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
      },
      signal: AbortSignal.timeout(init.method === "POST" ? 120_000 : 15_000),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CommsError(`Could not reach the comms agent at ${config.url}: ${reason}`);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail : response.statusText;
    const status = response.status === 401 ? 502 : response.status;
    throw new CommsError(
      response.status === 401
        ? "The comms agent refused the token. Check COMMS_AGENT_APPROVE_TOKEN."
        : `Comms agent error ${response.status}: ${detail}`,
      status
    );
  }
  return body;
}

export async function listCommsDrafts(config: CommsConfig, status: "pending" | "recent" = "pending") {
  const body = await call(config, `/drafts?status=${status}`);
  return (Array.isArray(body.drafts) ? body.drafts : []) as CommsDraft[];
}

export async function actOnCommsDraft(
  config: CommsConfig,
  id: number,
  action: CommsAction,
  input: { text?: string; guidance?: string } = {}
) {
  if (!Number.isInteger(id) || id <= 0) throw new CommsError("Invalid draft id.", 400);
  const payload =
    action === "send"
      ? { text: input.text ?? "" }
      : action === "redo"
        ? { guidance: input.guidance ?? "" }
        : {};
  if (action === "redo" && !payload.guidance?.trim()) {
    throw new CommsError("Say how to redraft it.", 400);
  }
  const body = await call(config, `/drafts/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    ok: action === "redo" ? true : body.ok === true,
    message: typeof body.message === "string" ? body.message : "",
    draft: body.draft as CommsDraft | undefined,
  };
}
