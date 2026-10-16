import { handleUserMessage } from "@/lib/agent/run";
import { sseResponse } from "@/lib/sse";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const body = (await req.json()) as {
    conversationId: string;
    text: string;
    mentions?: string[];
    skillId?: string;
    attachments?: { name: string; path: string }[];
  };
  if (!body.conversationId || !body.text?.trim()) {
    return Response.json({ error: "conversationId and text are required." }, { status: 400 });
  }
  return sseResponse((emit) =>
    handleUserMessage({
      conversationId: body.conversationId,
      text: body.text,
      mentions: body.mentions,
      skillId: body.skillId,
      attachments: body.attachments,
      emit,
    })
  );
}
