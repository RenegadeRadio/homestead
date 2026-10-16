"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Keyboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BrowserStatus } from "@/lib/browser-types";

export type ShotClickMapping = { x: number; y: number } | { outside: true };

export function mapShotClickToViewport(
  elementWidth: number,
  elementHeight: number,
  clickX: number,
  clickY: number,
  viewportWidth: number,
  viewportHeight: number,
): ShotClickMapping {
  if (elementWidth <= 0 || elementHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { outside: true };
  }

  const scale = Math.min(elementWidth / viewportWidth, elementHeight / viewportHeight);
  const pictureWidth = viewportWidth * scale;
  const pictureHeight = viewportHeight * scale;
  const pictureX = clickX - (elementWidth - pictureWidth) / 2;
  const pictureY = clickY - (elementHeight - pictureHeight) / 2;

  if (pictureX < 0 || pictureY < 0 || pictureX > pictureWidth || pictureY > pictureHeight) {
    return { outside: true };
  }

  return {
    x: Math.round(pictureX / scale),
    y: Math.round(pictureY / scale),
  };
}

async function browserGet(): Promise<BrowserStatus> {
  const res = await fetch("/api/browser", { cache: "no-store" });
  return res.json();
}

async function browserAct(action: string, extra?: Record<string, unknown>) {
  const res = await fetch("/api/browser", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Browser failed.");
  return data as BrowserStatus;
}

export function LiveBrowser() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [url, setUrl] = useState("https://www.linkedin.com/");
  const [typed, setTyped] = useState("");
  const [shot, setShot] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await browserGet();
      setStatus(next);
      if (next.url) setUrl(next.url);
      if (next.running) setShot(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser unavailable.");
    }
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 1200);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
    };
  }, [refresh]);

  async function start(target?: string) {
    setError(null);
    try {
      await browserAct("start", { url: target || url || "https://www.linkedin.com/" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the browser.");
    }
  }

  async function onShotClick(e: React.MouseEvent<HTMLImageElement>) {
    const img = imgRef.current;
    if (!img || !status?.running) return;
    const rect = img.getBoundingClientRect();
    const mapping = mapShotClickToViewport(
      rect.width,
      rect.height,
      e.clientX - rect.left,
      e.clientY - rect.top,
      status.width || 1280,
      status.height || 800,
    );
    if ("outside" in mapping) return;
    await browserAct("click", mapping);
    setShot(Date.now());
  }

  const human = status?.mode === "human";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void (status?.running ? browserAct("navigate", { url }).then(refresh) : start(url));
          }}
          className="min-w-0 flex-1 font-mono text-xs"
          placeholder="https://www.linkedin.com/"
        />
        {status?.running ? (
          <>
            <Button size="sm" variant="outline" onClick={() => void browserAct("navigate", { url }).then(refresh)}>
              Go
            </Button>
            {human ? (
              <Button size="sm" onClick={() => void browserAct("continue").then(refresh)}>
                Continue
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void browserAct("takeover").then(refresh)}>
                Take over
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void browserAct("stop").then(refresh)}>
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => void start()}>
            Start browser
          </Button>
        )}
      </div>

      {human ? (
        <div className="border-b bg-primary/10 px-3 py-1.5 text-xs">
          You have the computer. Sign in, solve CAPTCHA, paste 2FA — then Continue. Secrets stay in the browser, not chat.
          {status?.takeoverReason ? <span className="text-muted-foreground"> {status.takeoverReason}</span> : null}
        </div>
      ) : null}

      <div className="min-h-[280px] flex-1 overflow-auto bg-black/40">
        {status?.running ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={`/api/browser?shot=1&t=${shot}`}
            alt="Shared browser"
            className="mx-auto block max-h-full w-full cursor-crosshair object-contain"
            onClick={(e) => void onShotClick(e)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <Globe className="size-8 text-primary" />
            <p className="max-w-sm">
              This is the Bots&apos; browser. Start it, take over to log into LinkedIn (or anything else), then Continue and they keep the session.
            </p>
          </div>
        )}
      </div>

      {status?.running ? (
        <form
          className="flex items-center gap-2 border-t px-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed) return;
            void browserAct("type", { text: typed }).then(() => {
              setTyped("");
              setShot(Date.now());
            });
          }}
        >
          <Keyboard className="size-3.5 text-muted-foreground" />
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={human ? "Type here (passwords included) — not in chat" : "Type into the focused field"}
            type={human ? "password" : "text"}
            className="flex-1 text-xs"
          />
          <Button size="sm" type="submit" variant="outline">
            Type
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => void browserAct("press", { key: "Enter" }).then(refresh)}>
            Enter
          </Button>
        </form>
      ) : null}
      {error ? <p className="px-3 py-1 text-xs text-destructive">{error}</p> : null}
      {status?.title ? (
        <div className="truncate border-t px-3 py-1 text-[11px] text-muted-foreground">
          {status.mode === "human" ? "You" : "Bot"} · {status.title}
        </div>
      ) : null}
    </div>
  );
}
