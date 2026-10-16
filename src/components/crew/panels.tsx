"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BotAvatar } from "@/components/crew/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/hooks/use-now";
import { loadModels, runRoutine } from "@/lib/client";
import {
  DEFAULT_BANNED_PHRASES,
  DEFAULT_STANDING_RULES,
} from "@/lib/agent/draft-check";
import { DEFAULT_TOOL_BUDGET_PER_TURN } from "@/lib/agent/tool-budget";
import { DEFAULT_LINKEDIN_GAP_SECONDS } from "@/lib/agent/linkedin-pacing";
import {
  DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS,
  DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS,
  DEFAULT_LINKEDIN_DAILY_INVITE_CAP,
  DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP,
  DEFAULT_LINKEDIN_DAILY_PAGE_LOADS,
  DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY,
  DEFAULT_LINKEDIN_SEND_WINDOW_END,
  DEFAULT_LINKEDIN_SEND_WINDOW_START,
  countLinkedInInvitesToday,
  countLinkedInInvitesLast7Days,
  formatSastTime,
  pruneLinkedInPageLoads,
} from "@/lib/agent/linkedin-budget";
import {
  DEFAULT_X_DAILY_PAGE_LOADS,
  pruneXPageLoads,
} from "@/lib/agent/x-budget";
import type { MutateOp } from "@/lib/ops";
import type { Bot, Store } from "@/lib/types";

const field = "grid gap-1.5 text-sm";
const labelCls = "text-xs font-medium text-muted-foreground";

export function SkillsPane({
  store,
  mutateAndRefresh,
}: {
  store: Store;
  mutateAndRefresh: (op: MutateOp) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const current = store.skills.find((s) => s.id === editing);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-6 lg:grid-cols-[280px_1fr]">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Skills</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A skill is how a task is done: steps, decision rules, expected output, approval boundary. Invoke with /slug in chat.
        </p>
        <div className="mt-4 space-y-1">
          {store.skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => {
                setEditing(skill.id);
                setName(skill.name);
                setBody(skill.body);
              }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                editing === skill.id ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <div className="font-medium">{skill.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">/{skill.slug}</div>
            </button>
          ))}
        </div>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setName("");
            setBody("");
          }}
        >
          New skill
        </Button>
      </div>
      <div className="space-y-3">
        <div className={field}>
          <span className={labelCls}>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Source-backed research" />
        </div>
        <div className={field}>
          <span className={labelCls}>Instructions</span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-64 font-mono text-xs"
            placeholder="Steps, failure handling, and what must wait for approval."
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              if (!name.trim() || !body.trim()) return;
              if (editing) await mutateAndRefresh({ op: "updateSkill", id: editing, patch: { name, body } });
              else {
                const res = (await mutateAndRefresh({ op: "createSkill", skill: { name, body } })) as { skill: { id: string } };
                setEditing(res.skill.id);
              }
              toast.success("Skill saved. Type / in chat to run it.");
            }}
          >
            Save skill
          </Button>
          {editing ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await mutateAndRefresh({ op: "deleteSkill", id: editing });
                setEditing(null);
                setName("");
                setBody("");
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
        {current ? (
          <p className="text-xs text-muted-foreground">
            Reference in chat as <span className="font-mono">/{current.slug}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function RoutinesPane({
  store,
  mutateAndRefresh,
  onOpenConversation,
}: {
  store: Store;
  mutateAndRefresh: (op: MutateOp) => Promise<unknown>;
  onOpenConversation: (id: string) => void;
}) {
  const [name, setName] = useState("Weekday briefing");
  const [cron, setCron] = useState("0 8 * * 1-5");
  const [prompt, setPrompt] = useState("Run the daily briefing skill. Leave the file for review. Do not send anything.");
  const [botId, setBotId] = useState(store.bots[0]?.id || "");
  const [skillId, setSkillId] = useState(store.skills[0]?.id || "");
  const [conversationId, setConversationId] = useState(
    store.conversations.find((c) => c.kind === "group")?.id || store.conversations[0]?.id || ""
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Routines</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A routine assigns a workflow to one Bot and says when to run it. Homestead fires due routines while this app is running.
        </p>
      </div>
      {store.routines.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No routines yet. Test the skill as a one-off chat first, then put it on a schedule.
        </div>
      ) : (
        <div className="space-y-2">
          {store.routines.map((r) => {
            const bot = store.bots.find((b) => b.id === r.botId);
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border p-3">
                {bot ? <BotAvatar bot={bot} size="sm" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.cron} · next {r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : "—"}
                    {r.lastRunAt ? ` · last ${new Date(r.lastRunAt).toLocaleString()}` : ""}
                  </div>
                </div>
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(checked) =>
                    void mutateAndRefresh({ op: "updateRoutine", id: r.id, patch: { enabled: Boolean(checked) } })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    onOpenConversation(r.conversationId);
                    toast.message("Running routine…");
                    await runRoutine(r.id, () => undefined);
                    toast.success("Routine finished.");
                  }}
                >
                  Run now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => mutateAndRefresh({ op: "deleteRoutine", id: r.id })}>
                  Delete
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div className="space-y-3 rounded-xl border p-4">
        <div className="text-sm font-medium">New routine</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={field}>
            <span className={labelCls}>Cron</span>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" />
          </label>
          <label className={field}>
            <span className={labelCls}>Bot</span>
            <select className={selectCls} value={botId} onChange={(e) => setBotId(e.target.value)}>
              {store.bots.filter((b) => !b.archived).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className={labelCls}>Skill</span>
            <select className={selectCls} value={skillId} onChange={(e) => setSkillId(e.target.value)}>
              <option value="">None</option>
              {store.skills.map((s) => (
                <option key={s.id} value={s.id}>
                  /{s.slug}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className={labelCls}>Conversation</span>
            <select className={selectCls} value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
              {store.conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button
          onClick={async () => {
            await mutateAndRefresh({
              op: "createRoutine",
              routine: {
                name,
                cron,
                prompt,
                botId,
                skillId: skillId || undefined,
                conversationId,
                enabled: true,
              },
            });
            toast.success("Routine scheduled.");
          }}
        >
          Create routine
        </Button>
      </div>
    </div>
  );
}

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

export function SettingsPane({
  store,
  mutateAndRefresh,
}: {
  store: Store;
  mutateAndRefresh: (op: MutateOp) => Promise<unknown>;
}) {
  const now = useNow();
  const [rule, setRule] = useState("");
  const [models, setModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    for (const p of store.providers) {
      if (p.kind === "demo") continue;
      void loadModels(p.id).then((res) => {
        if (res.models?.length) setModels((m) => ({ ...m, [p.id]: res.models }));
      });
    }
  }, [store.providers]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Point any Bot at any model. Demo works with no keys. OpenAI-compatible covers OpenAI, xAI, Groq, OpenRouter, Ollama, vLLM, and llama.cpp.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Models</h2>
        {store.providers.map((p) => (
          <div key={p.id} className="space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <Input
                defaultValue={p.name}
                onBlur={(e) => mutateAndRefresh({ op: "updateProvider", id: p.id, patch: { name: e.target.value } })}
                className="max-w-xs font-medium"
              />
              <span className="text-[11px] text-muted-foreground uppercase">{p.kind}</span>
            </div>
            {p.kind === "claude-code" ? (
              <>
                <label className={field}>
                  <span className={labelCls}>Default model</span>
                  <Input
                    defaultValue={p.defaultModel}
                    list={`models-${p.id}`}
                    onBlur={(e) =>
                      mutateAndRefresh({ op: "updateProvider", id: p.id, patch: { defaultModel: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                  <datalist id={`models-${p.id}`}>
                    {(models[p.id] || []).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>
                <p className="text-xs text-muted-foreground">
                  Uses the <code>claude</code> CLI signed in on this machine. No API key; usage counts against your Claude plan.
                </p>
              </>
            ) : p.kind !== "demo" ? (
              <>
                <label className={field}>
                  <span className={labelCls}>Base URL</span>
                  <Input
                    defaultValue={p.baseUrl}
                    onBlur={(e) =>
                      mutateAndRefresh({ op: "updateProvider", id: p.id, patch: { baseUrl: e.target.value } })
                    }
                    placeholder="https://api.openai.com/v1"
                    className="font-mono text-xs"
                  />
                </label>
                <label className={field}>
                  <span className={labelCls}>API key</span>
                  <Input
                    type="password"
                    defaultValue={p.apiKey}
                    placeholder={p.apiKey ? "saved locally" : "sk-…"}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== "••••••••") {
                        void mutateAndRefresh({ op: "updateProvider", id: p.id, patch: { apiKey: e.target.value } });
                        toast.success("Key stored on this machine only.");
                      }
                    }}
                  />
                </label>
                <label className={field}>
                  <span className={labelCls}>Default model</span>
                  <Input
                    defaultValue={p.defaultModel}
                    list={`models-${p.id}`}
                    onBlur={(e) =>
                      mutateAndRefresh({ op: "updateProvider", id: p.id, patch: { defaultModel: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                  <datalist id={`models-${p.id}`}>
                    {(models[p.id] || []).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Built-in teammate that can still search, write files, and run approved commands so you can try Homestead without a key.
              </p>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              mutateAndRefresh({
                op: "createProvider",
                provider: {
                  name: "Custom OpenAI-compatible",
                  kind: "openai-compatible",
                  baseUrl: "http://127.0.0.1:11434/v1",
                  defaultModel: "llama3.1",
                },
              })
            }
          >
            Add provider
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              mutateAndRefresh({
                op: "createProvider",
                provider: {
                  name: "Claude Code (subscription)",
                  kind: "claude-code",
                  baseUrl: "",
                  apiKey: "",
                  defaultModel: "claude-sonnet-5",
                },
              })
            }
          >
            Add Claude Code (subscription)
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Assign models to Bots</h2>
        {store.bots
          .filter((b) => !b.archived)
          .map((bot) => (
            <div key={bot.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
              <BotAvatar bot={bot} size="sm" />
              <div className="w-28 text-sm font-medium">{bot.name}</div>
              <select
                className={`${selectCls} max-w-48`}
                value={bot.providerId}
                onChange={(e) => {
                  const provider = store.providers.find((p) => p.id === e.target.value);
                  void mutateAndRefresh({
                    op: "updateBot",
                    id: bot.id,
                    patch: { providerId: e.target.value, model: provider?.defaultModel || bot.model },
                  });
                }}
              >
                {store.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Input
                className="max-w-56 font-mono text-xs"
                defaultValue={bot.model}
                key={`${bot.id}-${bot.model}`}
                onBlur={(e) => mutateAndRefresh({ op: "updateBot", id: bot.id, patch: { model: e.target.value } })}
              />
            </div>
          ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Approvals</h2>
        <p className="text-sm text-muted-foreground">
          Sensitive commands stop for you. Always-allow rules still lose to require-approval.
        </p>
        <label className={field}>
          <span className={labelCls}>Shell policy</span>
          <select
            className={selectCls}
            value={store.settings.shellPolicy}
            onChange={(e) =>
              mutateAndRefresh({
                op: "updateSettings",
                patch: { shellPolicy: e.target.value as Store["settings"]["shellPolicy"] },
              })
            }
          >
            <option value="ask">Ask every time</option>
            <option value="allow">Allow (still honor require-approval rules)</option>
            <option value="never">Never allowed</option>
          </select>
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn action gap min (seconds)</span>
          <Input
            type="number"
            min={0}
            defaultValue={store.settings.linkedinActionGapMinSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS}
            key={`linkedin-action-min-${store.settings.linkedinActionGapMinSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              const max = store.settings.linkedinActionGapMaxSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS;
              if (Number.isInteger(value) && value >= 0 && value <= max) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinActionGapMinSeconds: value } });
              } else {
                e.target.value = String(store.settings.linkedinActionGapMinSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS);
              }
            }}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn action gap max (seconds)</span>
          <Input
            type="number"
            min={0}
            defaultValue={store.settings.linkedinActionGapMaxSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS}
            key={`linkedin-action-max-${store.settings.linkedinActionGapMaxSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              const min = store.settings.linkedinActionGapMinSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MIN_SECONDS;
              if (Number.isInteger(value) && value >= min) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinActionGapMaxSeconds: value } });
              } else {
                e.target.value = String(store.settings.linkedinActionGapMaxSeconds ?? DEFAULT_LINKEDIN_ACTION_GAP_MAX_SECONDS);
              }
            }}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn send window start</span>
          <Input
            type="time"
            defaultValue={store.settings.linkedinSendWindowStart ?? DEFAULT_LINKEDIN_SEND_WINDOW_START}
            key={`linkedin-window-start-${store.settings.linkedinSendWindowStart ?? DEFAULT_LINKEDIN_SEND_WINDOW_START}`}
            className="max-w-32"
            onBlur={(e) => {
              if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinSendWindowStart: e.target.value } });
              } else {
                e.target.value = store.settings.linkedinSendWindowStart ?? DEFAULT_LINKEDIN_SEND_WINDOW_START;
              }
            }}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn send window end</span>
          <Input
            type="time"
            defaultValue={store.settings.linkedinSendWindowEnd ?? DEFAULT_LINKEDIN_SEND_WINDOW_END}
            key={`linkedin-window-end-${store.settings.linkedinSendWindowEnd ?? DEFAULT_LINKEDIN_SEND_WINDOW_END}`}
            className="max-w-32"
            onBlur={(e) => {
              if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinSendWindowEnd: e.target.value } });
              } else {
                e.target.value = store.settings.linkedinSendWindowEnd ?? DEFAULT_LINKEDIN_SEND_WINDOW_END;
              }
            }}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn weekdays only</span>
          <input
            type="checkbox"
            checked={store.settings.linkedinSendWeekdaysOnly ?? DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY}
            onChange={(e) => void mutateAndRefresh({ op: "updateSettings", patch: { linkedinSendWeekdaysOnly: e.target.checked } })}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>Send approved Outbox items without a second approval</span>
          <input
            type="checkbox"
            checked={store.settings.outboxSendWithoutFinalApproval ?? false}
            onChange={(e) => void mutateAndRefresh({ op: "updateSettings", patch: { outboxSendWithoutFinalApproval: e.target.checked } })}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>Send approved invites in code (the Bot steps in only when the page does not match)</span>
          <input
            type="checkbox"
            checked={store.settings.outboxDirectInvites ?? false}
            onChange={(e) => void mutateAndRefresh({ op: "updateSettings", patch: { outboxDirectInvites: e.target.checked } })}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn daily invite cap</span>
          <Input
            type="number"
            min={0}
            defaultValue={store.settings.linkedinDailyInviteCap ?? DEFAULT_LINKEDIN_DAILY_INVITE_CAP}
            key={`linkedin-invite-cap-${store.settings.linkedinDailyInviteCap ?? DEFAULT_LINKEDIN_DAILY_INVITE_CAP}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 0) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinDailyInviteCap: value } });
              } else {
                e.target.value = String(store.settings.linkedinDailyInviteCap ?? DEFAULT_LINKEDIN_DAILY_INVITE_CAP);
              }
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {countLinkedInInvitesToday(new Date(), store.linkedinSendLog)} of{" "}
          {store.settings.linkedinDailyInviteCap ?? DEFAULT_LINKEDIN_DAILY_INVITE_CAP} LinkedIn invites sent today.
        </p>
        <label className={field}>
          <span className={labelCls}>LinkedIn weekly invite cap</span>
          <Input
            type="number"
            min={0}
            defaultValue={store.settings.linkedinWeeklyInviteCap ?? DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP}
            key={`linkedin-weekly-invite-cap-${store.settings.linkedinWeeklyInviteCap ?? DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 0) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinWeeklyInviteCap: value } });
              } else {
                e.target.value = String(store.settings.linkedinWeeklyInviteCap ?? DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP);
              }
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {countLinkedInInvitesLast7Days(new Date(), store.linkedinSendLog)} LinkedIn invites in the last 7 days.
        </p>
        {(() => {
          const until = new Date(store.settings.linkedinInvitesPausedUntil ?? "");
          if (!Number.isFinite(until.getTime()) || until.getTime() <= now) return null;
          return (
            <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
              <p>
                LinkedIn invites paused until {formatSastTime(until)}: {store.settings.linkedinInvitePauseReason ?? ""}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => mutateAndRefresh({
                  op: "updateSettings",
                  patch: { linkedinInvitesPausedUntil: null, linkedinInvitePauseReason: null },
                })}
              >
                Clear invite pause
              </Button>
            </div>
          );
        })()}
        <label className={field}>
          <span className={labelCls}>LinkedIn daily page loads</span>
          <Input
            type="number"
            min={0}
            defaultValue={store.settings.linkedinDailyPageLoads ?? DEFAULT_LINKEDIN_DAILY_PAGE_LOADS}
            key={`linkedin-page-limit-${store.settings.linkedinDailyPageLoads ?? DEFAULT_LINKEDIN_DAILY_PAGE_LOADS}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 0) {
                void mutateAndRefresh({ op: "updateSettings", patch: { linkedinDailyPageLoads: value } });
              } else {
                e.target.value = String(store.settings.linkedinDailyPageLoads ?? DEFAULT_LINKEDIN_DAILY_PAGE_LOADS);
              }
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {pruneLinkedInPageLoads(store.settings.linkedinPageLoads, new Date()).length} of{" "}
          {store.settings.linkedinDailyPageLoads ?? DEFAULT_LINKEDIN_DAILY_PAGE_LOADS} LinkedIn page loads recorded in the last 24 hours.
        </p>
        {store.settings.linkedinHold ? (
          <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
            <p>LinkedIn hold: {store.settings.linkedinHold}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => mutateAndRefresh({ op: "updateSettings", patch: { linkedinHold: "" } })}
            >
              Clear LinkedIn hold
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {pruneXPageLoads(store.settings.xPageLoads, new Date()).length} of{" "}
          {store.settings.xDailyPageLoads ?? DEFAULT_X_DAILY_PAGE_LOADS} X page loads recorded in the last 24 hours.
        </p>
        {store.settings.xHold ? (
          <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
            <p>X hold: {store.settings.xHold}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => mutateAndRefresh({ op: "updateSettings", patch: { xHold: "" } })}
            >
              Clear X hold
            </Button>
          </div>
        ) : null}
        <label className={field}>
          <span className={labelCls}>LinkedIn gap (seconds)</span>
          <Input
            type="number"
            defaultValue={store.settings.linkedinGapSeconds ?? DEFAULT_LINKEDIN_GAP_SECONDS}
            key={`linkedin-gap-${store.settings.linkedinGapSeconds ?? DEFAULT_LINKEDIN_GAP_SECONDS}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 60) {
                void mutateAndRefresh({
                  op: "updateSettings",
                  patch: { linkedinGapSeconds: value },
                });
              } else {
                e.target.value = String(
                  store.settings.linkedinGapSeconds ?? DEFAULT_LINKEDIN_GAP_SECONDS
                );
              }
            }}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>LinkedIn gap maximum (seconds)</span>
          <Input
            type="number"
            min={60}
            step={1}
            defaultValue={store.settings.linkedinGapMaxSeconds ?? ""}
            key={`linkedin-gap-max-${store.settings.linkedinGapMaxSeconds ?? ""}`}
            className="max-w-32"
            onBlur={(e) => {
              const input = e.target.value.trim();
              if (input === "") {
                void mutateAndRefresh({
                  op: "updateSettings",
                  patch: { linkedinGapMaxSeconds: null },
                });
                return;
              }
              const value = Number(input);
              if (Number.isInteger(value) && value >= 60) {
                void mutateAndRefresh({
                  op: "updateSettings",
                  patch: { linkedinGapMaxSeconds: value },
                });
              } else {
                e.target.value = String(store.settings.linkedinGapMaxSeconds ?? "");
              }
            }}
          />
        </label>
        <label className={field}>
          <span className={labelCls}>Tool calls per turn</span>
          <Input
            type="number"
            min={5}
            max={500}
            step={1}
            defaultValue={store.settings.toolBudgetPerTurn ?? DEFAULT_TOOL_BUDGET_PER_TURN}
            key={`tool-budget-${store.settings.toolBudgetPerTurn ?? DEFAULT_TOOL_BUDGET_PER_TURN}`}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 5 && value <= 500) {
                void mutateAndRefresh({
                  op: "updateSettings",
                  patch: { toolBudgetPerTurn: value },
                });
              } else {
                e.target.value = String(
                  store.settings.toolBudgetPerTurn ?? DEFAULT_TOOL_BUDGET_PER_TURN
                );
              }
            }}
          />
        </label>
        <div className="space-y-1">
          {store.settings.autoReview.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
              <span className="uppercase text-muted-foreground">{r.kind}</span>
              <code className="flex-1">{r.pattern}</code>
              <Button size="xs" variant="ghost" onClick={() => mutateAndRefresh({ op: "removeAutoReview", id: r.id })}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Regex, e.g. ^git status" className="font-mono" />
          <Button
            variant="outline"
            onClick={() => {
              if (!rule.trim()) return;
              void mutateAndRefresh({ op: "addAutoReview", kind: "always-allow", pattern: rule.trim() });
              setRule("");
            }}
          >
            Always allow
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!rule.trim()) return;
              void mutateAndRefresh({ op: "addAutoReview", kind: "require-approval", pattern: rule.trim() });
              setRule("");
            }}
          >
            Require approval
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Client-facing text</h2>
        <label className={field}>
          <span className={labelCls}>Standing rules</span>
          <Textarea
            defaultValue={store.settings.standingRules || DEFAULT_STANDING_RULES}
            key={`standing-rules-${store.settings.standingRules || DEFAULT_STANDING_RULES}`}
            onBlur={(e) =>
              mutateAndRefresh({
                op: "updateSettings",
                patch: { standingRules: e.target.value },
              })
            }
          />
        </label>
        <label className={field}>
          <span className={labelCls}>Banned phrases (one per line)</span>
          <Textarea
            defaultValue={(store.settings.draftBannedPhrases ?? DEFAULT_BANNED_PHRASES).join("\n")}
            key={`draft-banned-${(store.settings.draftBannedPhrases ?? DEFAULT_BANNED_PHRASES).join("\n")}`}
            onBlur={(e) =>
              mutateAndRefresh({
                op: "updateSettings",
                patch: {
                  draftBannedPhrases: e.target.value
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Plugins</h2>
        <p className="text-sm text-muted-foreground">
          HTTP connectors. A Bot can call them with call_plugin when you mention the connector in a task.
        </p>
        {store.plugins.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Add a base URL for a service you already run.</p>
        ) : (
          store.plugins.map((p) => (
            <div key={p.id} className="rounded-xl border p-3 text-sm">
              <div className="font-medium">{p.name}</div>
              <div className="font-mono text-xs text-muted-foreground">{p.baseUrl}</div>
            </div>
          ))
        )}
        <PluginForm onCreate={(plugin) => mutateAndRefresh({ op: "createPlugin", plugin })} />
      </section>
    </div>
  );
}

function PluginForm({ onCreate }: { onCreate: (plugin: { name: string; description: string; baseUrl: string }) => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" className="font-mono text-xs" />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it does" className="sm:col-span-2" />
      <Button
        variant="outline"
        onClick={() => {
          if (!name || !baseUrl) return;
          onCreate({ name, baseUrl, description });
          setName("");
          setBaseUrl("");
          setDescription("");
        }}
      >
        Add plugin
      </Button>
    </div>
  );
}

export function NewBotDialog({
  open,
  onOpenChange,
  store,
  mutateAndRefresh,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: Store;
  mutateAndRefresh: (op: MutateOp) => Promise<unknown>;
  onCreated: (bot: Bot) => void;
}) {
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [instructions, setInstructions] = useState("");
  const [emoji, setEmoji] = useState("✦");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Bot</DialogTitle>
          <DialogDescription>
            Describe the job. Grant tools as it asks. Same Bot tomorrow — context compounds.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Rowan" />
          <Input value={job} onChange={(e) => setJob(e.target.value)} placeholder="Job, e.g. Inbox and calendar" />
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Standing instructions and approval boundaries"
          />
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-20" />
        </div>
        <DialogFooter>
          <Button
            onClick={async () => {
              const res = (await mutateAndRefresh({
                op: "createBot",
                bot: {
                  name: name || "New Bot",
                  job: job || "Teammate",
                  instructions,
                  emoji,
                  providerId: store.providers[0]?.id,
                },
              })) as { bot: Bot };
              onCreated(res.bot);
              onOpenChange(false);
              setName("");
              setJob("");
              setInstructions("");
            }}
          >
            Create Bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewGroupDialog({
  open,
  onOpenChange,
  store,
  mutateAndRefresh,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: Store;
  mutateAndRefresh: (op: MutateOp) => Promise<unknown>;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [ids, setIds] = useState<string[]>([]);

  function toggle(id: string) {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Two to six Bots, one shared outcome, visible handoffs.</DialogDescription>
        </DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group name" />
        <div className="grid gap-1">
          {store.bots
            .filter((b) => !b.archived)
            .map((bot) => (
              <label key={bot.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                <input type="checkbox" checked={ids.includes(bot.id)} onChange={() => toggle(bot.id)} />
                <BotAvatar bot={bot} size="sm" />
                {bot.name}
                <span className="text-xs text-muted-foreground">{bot.job}</span>
              </label>
            ))}
        </div>
        <DialogFooter>
          <Button
            disabled={ids.length < 2}
            onClick={async () => {
              const res = (await mutateAndRefresh({
                op: "createConversation",
                kind: "group",
                botIds: ids,
                title: title || undefined,
              })) as { conversation: { id: string } };
              onCreated(res.conversation.id);
              onOpenChange(false);
              setIds([]);
              setTitle("");
            }}
          >
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
