import { runRoutineNow } from "@/lib/agent/run";
import { sseResponse } from "@/lib/sse";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const body = (await req.json()) as { id: string };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  return sseResponse((emit) => runRoutineNow(body.id, emit));
}
