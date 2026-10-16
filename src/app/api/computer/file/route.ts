import { readComputerFile } from "@/lib/computer";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";
  try {
    const content = await readComputerFile(path);
    return Response.json({ path, content });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not read file." },
      { status: 400 }
    );
  }
}
