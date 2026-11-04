import {
  actOnCommsDraft,
  CommsError,
  listCommsDrafts,
  readCommsConfig,
  type CommsAction,
} from "@/lib/comms";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

const ACTIONS: CommsAction[] = ["send", "skip", "redo"];

function failure(error: unknown) {
  if (error instanceof CommsError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "Unexpected error talking to the comms agent." }, { status: 500 });
}

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const config = readCommsConfig();
  if (!config) return Response.json({ configured: false, drafts: [], recent: [] });
  try {
    const [drafts, recent] = await Promise.all([
      listCommsDrafts(config, "pending"),
      listCommsDrafts(config, "recent"),
    ]);
    return Response.json({ configured: true, drafts, recent: recent.slice(0, 15) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const config = readCommsConfig();
  if (!config) return Response.json({ error: "The comms agent is not configured." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action as CommsAction;
  if (!body || !ACTIONS.includes(action)) {
    return Response.json({ error: "action must be send, skip or redo." }, { status: 400 });
  }
  try {
    const result = await actOnCommsDraft(config, Number(body.id), action, {
      text: typeof body.text === "string" ? body.text : undefined,
      guidance: typeof body.guidance === "string" ? body.guidance : undefined,
    });
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}
