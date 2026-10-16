import {
  browserStatus,
  closeBrowser,
  ensureBrowser,
  humanClick,
  humanNavigate,
  humanPress,
  humanType,
  screenshot,
  setBrowserMode,
} from "@/lib/browser";
import { guardLocalRequest } from "@/lib/local-request";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const url = new URL(req.url);
  if (url.searchParams.get("shot") === "1") {
    try {
      await ensureBrowser();
      const buf = await screenshot();
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Screenshot failed." },
        { status: 500 }
      );
    }
  }
  return Response.json(await browserStatus());
}

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const body = (await req.json()) as {
    action: string;
    url?: string;
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    reason?: string;
  };
  try {
    switch (body.action) {
      case "start":
        await ensureBrowser();
        if (body.url) await humanNavigate(body.url);
        return Response.json(await browserStatus());
      case "navigate":
        if (!body.url) return Response.json({ error: "url required" }, { status: 400 });
        await humanNavigate(body.url);
        return Response.json(await browserStatus());
      case "click":
        await humanClick(Number(body.x), Number(body.y));
        return Response.json(await browserStatus());
      case "type":
        await humanType(String(body.text || ""));
        return Response.json(await browserStatus());
      case "press":
        await humanPress(body.key || "Enter");
        return Response.json(await browserStatus());
      case "takeover":
        await setBrowserMode("human", body.reason || "You have the computer.");
        return Response.json(await browserStatus());
      case "continue":
        await setBrowserMode("bot");
        return Response.json(await browserStatus());
      case "stop":
        await closeBrowser();
        return Response.json(await browserStatus());
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Browser action failed." },
      { status: 500 }
    );
  }
}
