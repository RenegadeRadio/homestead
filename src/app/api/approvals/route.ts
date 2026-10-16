import { resolveApproval } from "@/lib/agent/run";
import { sseResponse } from "@/lib/sse";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const body = (await req.json()) as { approvalId: string; decision: "approved" | "denied" };
  if (!body.approvalId || !body.decision) {
    return Response.json({ error: "approvalId and decision are required." }, { status: 400 });
  }
  return sseResponse((emit) => resolveApproval({ ...body, emit }));
}
