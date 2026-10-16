import { saveUpload } from "@/lib/mutate";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const saved = await saveUpload(file.name, buf);
  return Response.json(saved);
}
