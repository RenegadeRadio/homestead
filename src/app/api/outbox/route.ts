import { guardLocalRequest } from "@/lib/local-request";
import { startOutboxRun } from "@/lib/outbox-bot";
import { isOutboxRunning } from "@/lib/outbox-sender";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  if (isOutboxRunning()) return Response.json({ started: false });
  return Response.json(await startOutboxRun());
}

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const store = await getStore();
  return Response.json({ running: isOutboxRunning(), items: store.outbox ?? [] });
}
