import { mutate, type MutateOp } from "@/lib/mutate";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  try {
    const body = (await req.json()) as MutateOp;
    const result = await mutate(body);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Mutation failed." },
      { status: 400 }
    );
  }
}
