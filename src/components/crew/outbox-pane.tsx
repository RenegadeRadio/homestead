"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/hooks/use-now";
import { DEFAULT_X_REPLY_EXPIRY_HOURS } from "@/lib/agent/x-budget";
import {
  parsePlaybookDrafts,
  type ParsedDraft,
  type RefusedHeading,
} from "@/lib/outbox-import";
import type { MutateOp } from "@/lib/ops";
import type { Store } from "@/lib/types";

interface OutboxRun {
  active: boolean;
  stopRequested: boolean;
  nextAt: string | null;
  reason: string;
  stalled: { id: string; name: string } | null;
}

interface ImportDraft extends ParsedDraft {
  profileUrl: string;
  error?: string;
}

export function OutboxPane({
  store,
  mutateAndRefresh,
  onSend,
}: {
  store: Store;
  mutateAndRefresh: (op: MutateOp) => Promise<unknown>;
  onSend: () => Promise<unknown>;
}) {
  const items = store.outbox || [];
  const now = useNow();
  const [view, setView] = useState<"outbox" | "history">("outbox");
  const outboxItems = items.filter(
    (item) => item.status === "draft" || item.status === "approved" || item.status === "sending"
  );
  const historyItems = items
    .filter(
      (item) => item.status === "sent" || item.status === "failed" || item.status === "rejected"
    )
    .sort((a, b) => {
      if (a.status === "failed" && b.status !== "failed") return -1;
      if (a.status !== "failed" && b.status === "failed") return 1;
      return (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt);
    });
  const failedCount = historyItems.filter((item) => item.status === "failed").length;
  const visibleItems = view === "history" ? historyItems : outboxItems;
  const xReplies = (store.xReplies ?? [])
    .filter((item) => {
      if (item.status !== "draft") return false;
      if (!item.postAt) return true;
      const postTime = new Date(item.postAt).getTime();
      if (!Number.isFinite(postTime)) return true;
      const expiryHours = store.settings.xReplyExpiryHours ?? DEFAULT_X_REPLY_EXPIRY_HOURS;
      return now - postTime <= expiryHours * 3_600_000;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const approvedCount = items.filter((item) => item.status === "approved").length;
  const [importText, setImportText] = useState("");
  const [importDrafts, setImportDrafts] = useState<ImportDraft[]>([]);
  const [importRefused, setImportRefused] = useState<RefusedHeading[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [evidenceText, setEvidenceText] = useState("");
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertEvidence, setRevertEvidence] = useState("");
  const [sendReason, setSendReason] = useState<string | null>(null);
  const [run, setRun] = useState<OutboxRun | null>(null);
  const [runFetchedAt, setRunFetchedAt] = useState(0);

  const fetchRun = useCallback(async () => {
    if (typeof fetch === "undefined") return;
    try {
      const response = await fetch("/api/outbox/run");
      if (response.ok) {
        setRun(await response.json());
        setRunFetchedAt(Date.now());
      }
    } catch {
      // The panel also renders in tests and environments without a local server.
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void fetchRun(), 0);
    return () => clearTimeout(timeout);
  }, [fetchRun]);

  useEffect(() => {
    if (!run?.active) return;
    const interval = setInterval(() => void fetchRun(), 5000);
    return () => clearInterval(interval);
  }, [fetchRun, run?.active]);

  const stopRun = async () => {
    if (typeof fetch === "undefined") return;
    try {
      const response = await fetch("/api/outbox/run", { method: "POST" });
      if (response.ok) setRun(await response.json());
    } catch {
      // A failed status refresh should not disrupt the existing outbox panel.
    }
  };

  const nextAt = run?.nextAt ? new Date(run.nextAt) : null;
  const nextAtLabel = nextAt && !Number.isNaN(nextAt.getTime())
    ? `${String(nextAt.getHours()).padStart(2, "0")}:${String(nextAt.getMinutes()).padStart(2, "0")}`
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Outbox</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review LinkedIn drafts before approving and sending them.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {run?.active ? (
            <>
              <p className="text-sm text-muted-foreground">
                Sending until the queue is empty
                {nextAtLabel ? ` — next at ${nextAtLabel}` : ""}
              </p>
              <Button variant="outline" onClick={() => void stopRun()}>
                Stop sending
              </Button>
            </>
          ) : run && approvedCount > 0 ? (
            <p className="text-sm text-destructive">{`Not sending: ${approvedCount} approved ${approvedCount === 1 ? "item is" : "items are"} waiting.${run.reason ? ` ${run.reason}` : ""}`}</p>
          ) : run?.reason ? (
            <p className="text-sm text-muted-foreground">{run.reason}</p>
          ) : null}
          {sendReason ? <p className="text-sm text-muted-foreground">{sendReason}</p> : null}
          <Button
            disabled={approvedCount === 0}
            onClick={() =>
              void onSend()
                .then((result) => {
                  if (
                    result &&
                    typeof result === "object" &&
                    "started" in result &&
                    result.started === false &&
                    "reason" in result &&
                    result.reason
                  ) {
                    setSendReason(String(result.reason));
                  } else {
                    setSendReason(null);
                  }
                })
                .finally(() => void fetchRun())
            }
          >
            Send approved ({approvedCount})
          </Button>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border p-4">
        <div className="space-y-2">
          <label htmlFor="playbook-note" className="text-sm font-medium">
            Playbook note
          </label>
          <Textarea
            id="playbook-note"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Paste playbook markdown here"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const parsed = parsePlaybookDrafts(importText);
            setImportDrafts(parsed.drafts.map((draft) => ({ ...draft, profileUrl: "" })));
            setImportRefused(parsed.refused);
          }}
        >
          Parse note
        </Button>

        {importDrafts.map((draft, index) => (
          <div key={`${draft.name}-${index}`} className="space-y-2 rounded-lg bg-muted/40 p-3">
            <h2 className="font-medium">{draft.name}</h2>
            <p className="whitespace-pre-wrap text-sm">{draft.text}</p>
            <Input
              aria-label={`Profile URL for ${draft.name}`}
              value={draft.profileUrl}
              onChange={(event) =>
                setImportDrafts((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, profileUrl: event.target.value, error: undefined } : item
                  )
                )
              }
              placeholder="LinkedIn profile URL"
            />
            {draft.error ? <p className="text-sm text-destructive">{draft.error}</p> : null}
          </div>
        ))}

        {importRefused.map((heading, index) => (
          <div key={`${heading.name}-${index}`} className="rounded-lg bg-muted/40 p-3 text-sm">
            <span className="font-medium">{heading.name}</span>: {heading.reason}
          </div>
        ))}

        {importDrafts.length > 0 ? (
          <Button
            onClick={async () => {
              const results = await Promise.all(
                importDrafts.map(async (draft) => {
                  const profileUrl = draft.profileUrl.trim();
                  if (!profileUrl) return draft;
                  try {
                    await mutateAndRefresh({
                      op: "createOutboxItem",
                      name: draft.name,
                      profileUrl,
                      text: draft.text,
                      note: draft.note,
                      lane: draft.lane,
                    });
                    return null;
                  } catch (error) {
                    return {
                      ...draft,
                      error: error instanceof Error ? error.message : String(error),
                    };
                  }
                })
              );
              setImportDrafts(results.filter((draft): draft is ImportDraft => draft !== null));
            }}
          >
            Add drafts
          </Button>
        ) : null}
      </section>

      <div className="flex gap-2" role="group" aria-label="Outbox view">
        <Button
          type="button"
          variant={view === "outbox" ? "default" : "outline"}
          aria-pressed={view === "outbox"}
          onClick={() => setView("outbox")}
        >
          Outbox ({outboxItems.length})
        </Button>
        <Button
          type="button"
          variant={view === "history" ? "default" : "outline"}
          aria-pressed={view === "history"}
          onClick={() => setView("history")}
        >
          History ({historyItems.length}{failedCount ? ` · ${failedCount} to check` : ""})
        </Button>
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {view === "outbox" ? "Nothing in the Outbox." : "No history yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => {
            const editable =
              item.status !== "sent" && item.status !== "rejected" && item.status !== "sending";
            const isEditing = editingId === item.id;

            return (
              <article key={item.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-medium">{item.name}</h2>
                    <a
                      href={item.profileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {item.profileUrl}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.kind === "invite" ? <span className="text-xs text-muted-foreground">Invite</span> : null}
                    {item.lane ? <span className="text-xs text-muted-foreground">Lane {item.lane}</span> : null}
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">
                      {item.status}
                    </span>
                  </div>
                </div>

                {isEditing ? (
                  <Textarea
                    aria-label={`Message for ${item.name}`}
                    value={draftText}
                    onChange={(event) => setDraftText(event.target.value)}
                    className="min-h-32"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{item.text}</p>
                )}

                {item.error ? <p className="text-sm text-destructive">{item.error}</p> : null}
                {item.status === "sent" && item.operatorConfirmation ? (
                  <p className="text-sm text-muted-foreground">
                    Confirmed by the operator: {item.operatorConfirmation.evidence}
                  </p>
                ) : null}
                {item.operatorCorrection ? (
                  <p className="text-sm text-muted-foreground">
                    Returned to the queue by the operator: {item.operatorCorrection.evidence}
                  </p>
                ) : null}
                {item.aftermath?.draftLeft ? (
                  <p className="text-sm text-destructive">
                    Text was left in the compose box on this profile.
                  </p>
                ) : null}
                {run?.stalled?.id === item.id && item.sendingAt ? (
                  <p className="text-sm text-destructive">
                    No LinkedIn activity for{" "}
                    {Math.floor((runFetchedAt - new Date(item.sendingAt).getTime()) / 60_000)} minutes.
                    {" "}Mark failed if it is stuck.
                  </p>
                ) : null}

                {item.note ? (
                  <div>
                    <h3 className="text-xs font-medium uppercase text-muted-foreground">Research</h3>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.note}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {editable && !isEditing ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(item.id);
                        setDraftText(item.text);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {editable && isEditing ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await mutateAndRefresh({
                          op: "updateOutboxItem",
                          id: item.id,
                          text: draftText,
                        });
                        setEditingId(null);
                      }}
                    >
                      Save
                    </Button>
                  ) : null}
                  {item.status === "draft" || item.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void mutateAndRefresh({ op: "approveOutboxItems", ids: [item.id] })}
                    >
                      Approve
                    </Button>
                  ) : null}
                  {item.status === "sending" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void mutateAndRefresh({ op: "failOutboxItem", id: item.id })}
                    >
                      Mark failed
                    </Button>
                  ) : null}
                  {item.status === "sending" || item.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setConfirmingId(item.id);
                        setEvidenceText("");
                      }}
                    >
                      Confirm sent
                    </Button>
                  ) : null}
                  {confirmingId === item.id ? (
                    <>
                      <Input
                        aria-label="Seen on LinkedIn"
                        value={evidenceText}
                        onChange={(event) => setEvidenceText(event.target.value)}
                      />
                      <Button
                        size="sm"
                        disabled={!evidenceText.trim()}
                        onClick={async () => {
                          await mutateAndRefresh({
                            op: "confirmOutboxItemSent",
                            id: item.id,
                            evidence: evidenceText.trim(),
                          });
                          setConfirmingId(null);
                          setEvidenceText("");
                        }}
                      >
                        Record as sent
                      </Button>
                    </>
                  ) : null}
                  {item.status === "sent" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRevertingId(item.id);
                        setRevertEvidence("");
                      }}
                    >
                      Not actually sent
                    </Button>
                  ) : null}
                  {revertingId === item.id ? (
                    <>
                      <Input
                        aria-label="What LinkedIn shows"
                        value={revertEvidence}
                        onChange={(event) => setRevertEvidence(event.target.value)}
                      />
                      <Button
                        size="sm"
                        disabled={!revertEvidence.trim()}
                        onClick={async () => {
                          await mutateAndRefresh({
                            op: "revertOutboxItemSent",
                            id: item.id,
                            evidence: revertEvidence.trim(),
                          });
                          setRevertingId(null);
                          setRevertEvidence("");
                        }}
                      >
                        Return to queue
                      </Button>
                    </>
                  ) : null}
                  {editable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void mutateAndRefresh({ op: "rejectOutboxItem", id: item.id })}
                    >
                      Reject
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">X replies</h2>
        {xReplies.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No X reply drafts are waiting.
          </p>
        ) : (
          xReplies.map((item) => {
            const postTime = item.postAt ? new Date(item.postAt).getTime() : Number.NaN;
            const ageMs = now - postTime;
            const age = Number.isFinite(postTime)
              ? ageMs >= 3_600_000
                ? `${Math.floor(ageMs / 3_600_000)} h`
                : `${Math.max(0, Math.floor(ageMs / 60_000))} min`
              : null;
            return <article key={item.id} className="space-y-3 rounded-xl border p-4">
              <h3 className="font-medium">
                {item.author.startsWith("@") ? item.author : `@${item.author}`}
              </h3>
              {age ? <p className="text-xs text-muted-foreground">posted {age} ago</p> : null}
              <p className="text-sm text-muted-foreground">{item.postExcerpt}</p>
              <p className="whitespace-pre-wrap text-sm">{item.text}</p>
              <p className="text-xs text-muted-foreground">{item.text.length}/280</p>
              {item.note ? (
                <div>
                  <h4 className="text-xs font-medium uppercase text-muted-foreground">Note</h4>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.note}</p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={item.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center rounded-lg border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                >
                  Open post
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(item.text)}
                >
                  Copy reply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void mutateAndRefresh({ op: "markXReplyPosted", id: item.id })}
                >
                  Mark posted
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void mutateAndRefresh({ op: "dropXReply", id: item.id })}
                >
                  Drop
                </Button>
              </div>
            </article>;
          })
        )}
      </section>
    </div>
  );
}
