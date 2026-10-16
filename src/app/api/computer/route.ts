import { listTree } from "@/lib/computer";
import { getStore, publicStore } from "@/lib/store";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const store = await getStore();
  const tree = await listTree(".", 6);
  return Response.json({
    tree,
    logs: store.computerLogs.slice(0, 80),
    terminal: store.terminalSessions.slice(0, 40),
    browse: store.browseSnapshots.slice(0, 20),
    root: store.settings.computerRoot,
    store: publicStore(store),
  });
}
