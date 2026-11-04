"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CommsDraft } from "@/lib/comms";

interface CommsState {
  configured: boolean;
  drafts: CommsDraft[];
  recent: CommsDraft[];
}

const REFRESH_MS = 30_000;

export function CommsPane() {
  const [state, setState] = useState<CommsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [guidance, setGuidance] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (typeof fetch === "undefined") return;
    try {
      const response = await fetch("/api/comms");
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not load drafts.");
        return;
      }
      setError(null);
      setState(body);
    } catch {
      setError("Could not reach Homestead's server.");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function act(draft: CommsDraft, action: "send" | "skip" | "redo") {
    setBusyId(draft.id);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = { id: draft.id, action };
      if (action === "send") payload.text = texts[draft.id] ?? draft.text;
      if (action === "redo") payload.guidance = guidance[draft.id] ?? "";
      const response = await fetch("/api/comms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setNotice(body.error ?? "That didn't work.");
      } else if (action === "redo") {
        setNotice(`Redrafted #${draft.id}.`);
        const updated = body.draft as CommsDraft | undefined;
        if (updated) {
          setState((current) =>
            current
              ? { ...current, drafts: current.drafts.map((d) => (d.id === updated.id ? updated : d)) }
              : current
          );
        }
        setTexts((current) => {
          const next = { ...current };
          delete next[draft.id];
          return next;
        });
        setGuidance((current) => ({ ...current, [draft.id]: "" }));
      } else {
        setNotice(body.message || null);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const drafts = state?.drafts ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Comms</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            WhatsApp and Gmail replies drafted by your comms agent. Nothing is sent until you press Send.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {notice ? (
        <div role="status" className="rounded-xl border p-3 text-sm">
          {notice}
        </div>
      ) : null}
      {error ? <div className="rounded-xl border border-destructive p-3 text-sm text-destructive">{error}</div> : null}

      {state && !state.configured ? (
        <div className="space-y-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <p>The comms agent isn&apos;t connected. Add these to Homestead&apos;s <code>.env.local</code> and restart:</p>
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
            COMMS_AGENT_URL=http://127.0.0.1:8000{"\n"}COMMS_AGENT_APPROVE_TOKEN=…
          </pre>
        </div>
      ) : null}

      {state?.configured && drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing waiting on you.</div>
      ) : null}

      <div className="space-y-3">
        {drafts.map((draft) => {
          const busy = busyId === draft.id;
          const who = draft.counterpart_name || draft.counterpart;
          return (
            <article key={draft.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">
                    {who}
                    {draft.subject ? <span className="text-muted-foreground"> — {draft.subject}</span> : null}
                  </h2>
                  <p className="text-sm">{draft.summary}</p>
                </div>
                <div className="flex items-center gap-2">
                  {draft.category === "urgent" ? (
                    <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                      Urgent
                    </span>
                  ) : null}
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                    {draft.channel === "gmail" ? "Email" : "WhatsApp"} #{draft.id}
                  </span>
                </div>
              </div>

              <details>
                <summary className="cursor-pointer text-xs font-medium uppercase text-muted-foreground">
                  Their message
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{draft.incoming}</p>
              </details>

              <Textarea
                aria-label={`Reply to ${who}`}
                value={texts[draft.id] ?? draft.text}
                onChange={(event) => setTexts((current) => ({ ...current, [draft.id]: event.target.value }))}
                className="min-h-28"
              />
              {draft.note ? <p className="text-sm text-muted-foreground">Note: {draft.note}</p> : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || !(texts[draft.id] ?? draft.text).trim()}
                  onClick={() => void act(draft, "send")}
                >
                  Send
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(draft, "skip")}>
                  Skip
                </Button>
                <Input
                  aria-label={`Redraft instruction for ${who}`}
                  placeholder="Redraft: e.g. decline politely"
                  value={guidance[draft.id] ?? ""}
                  onChange={(event) => setGuidance((current) => ({ ...current, [draft.id]: event.target.value }))}
                  className="min-w-48 flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !(guidance[draft.id] ?? "").trim()}
                  onClick={() => void act(draft, "redo")}
                >
                  Redo
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      {state?.recent?.length ? (
        <section className="space-y-1">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">Recent</h2>
          {state.recent.map((draft) => (
            <p key={draft.id} className="text-sm text-muted-foreground">
              #{draft.id} {draft.status} · {draft.counterpart_name || draft.counterpart}: {draft.summary}
              {draft.error ? ` — ${draft.error}` : ""}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}
