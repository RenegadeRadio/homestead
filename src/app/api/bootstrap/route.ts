import { getStore, publicStore } from "@/lib/store";
import { listTree } from "@/lib/computer";
import { startRoutineTicker } from "@/lib/routines";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  startRoutineTicker();
  const store = await getStore();
  const tree = await listTree(".", 5);
  return Response.json({ store: publicStore(store), tree });
}
