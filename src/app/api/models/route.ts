import { getStore } from "@/lib/store";
import { listOpenAIModels } from "@/lib/agent/providers";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const id = new URL(req.url).searchParams.get("providerId");
  const store = await getStore();
  const provider = store.providers.find((p) => p.id === id);
  if (!provider) return Response.json({ error: "Provider not found." }, { status: 404 });
  if (provider.kind === "demo") return Response.json({ models: ["crew-demo"] });
  if (provider.kind === "claude-code") {
    return Response.json({ models: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"] });
  }
  if (provider.kind === "anthropic") {
    return Response.json({
      models: ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    });
  }
  try {
    const models = await listOpenAIModels(provider.baseUrl, provider.apiKey);
    return Response.json({ models });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not list models.", models: [] },
      { status: 200 }
    );
  }
}
