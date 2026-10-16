import { linkedInProfileSlug } from "@/lib/agent/linkedin-send-log";
import { getOutboxRun, outboxStallMinutes, stopOutboxRun } from "@/lib/outbox-bot";
import { guardLocalRequest } from "@/lib/local-request";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const store = await getStore();
  const item = store.outbox?.find((candidate) => candidate.status === "sending");
  let stalled: { id: string; name: string } | null = null;
  if (item?.sendingAt) {
    const sendingAtMs = new Date(item.sendingAt).getTime();
    if (Date.now() - sendingAtMs >= outboxStallMinutes(store) * 60_000) {
      const slug = linkedInProfileSlug(item.profileUrl);
      const hasNewerActivity = slug !== null && (store.linkedinSendLog ?? []).some(
        (entry) => entry.slug === slug && new Date(entry.at).getTime() > sendingAtMs
      );
      if (!hasNewerActivity) stalled = { id: item.id, name: item.name };
    }
  }
  return Response.json({ ...getOutboxRun(), stalled });
}

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  stopOutboxRun();
  return Response.json(getOutboxRun());
}
