import {
  syncPendingSends,
  syncProspects,
  type CrmSyncCounts,
} from "@/lib/crm/notion-sync";
import { guardLocalRequest } from "@/lib/local-request";
import type { CrmSyncState } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const [sendCounts, prospectCounts] = await Promise.all([
    syncPendingSends({ fetchFn: fetch, env: process.env }),
    syncProspects({ fetchFn: fetch, env: process.env }),
  ]);
  const states: CrmSyncState[] = [
    "not-configured",
    "skipped",
    "no-row",
    "ambiguous",
    "synced",
    "failed",
  ];
  const counts = states.reduce<CrmSyncCounts>((combined, state) => {
    combined[state] = sendCounts[state] + prospectCounts[state];
    return combined;
  }, {} as CrmSyncCounts);
  return Response.json(counts);
}
