"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  FileText,
  Loader2,
  Paperclip,
  Square,
  X,
} from "lucide-react";

import { BotAvatar } from "@/components/crew/avatar";
import { Markdown } from "@/components/crew/markdown";
import { Button } from "@/components/ui/button";
import { mutate } from "@/lib/client";
import type { Bot, Conversation, Message, MessagePart, Skill, Store } from "@/lib/types";

export function ChatPane({
  store,
  conversation,
  messages,
  busy,
  onSend,
  onApproval,
  onOpenFile,
  onStop,
  onClear,
}: {
  store: Store;
  conversation: Conversation;
  messages: Message[];
  busy: boolean;
  onSend: (text: string, extras?: { mentions?: string[]; skillId?: string; files?: File[] }) => Promise<boolean | void>;
  onApproval: (id: string, decision: "approved" | "denied") => Promise<void>;
  onOpenFile: (path: string) => void;
  onStop: () => void;
  onClear?: () => Promise<void>;
}) {
  const members = store.bots.filter((b) => conversation.botIds.includes(b.id) && !b.archived);
  const endRef = useRef<HTMLDivElement>(null);
  const lastPartCount = messages[messages.length - 1]?.parts.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy, lastPartCount]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex -space-x-2">
          {members.slice(0, 4).map((b) => (
            <BotAvatar key={b.id} bot={b} size="sm" />
          ))}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{conversation.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {conversation.kind === "group"
              ? `${members.map((m) => m.name).join(" · ")} — write normally or @mention an owner`
              : members[0]
                ? `${members[0].job} · ${providerLabel(store, members[0])}`
                : "Direct message"}
          </div>
        </div>
        {onClear && messages.some((message) => message.role !== "system") ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Clear this chat? The messages and any waiting approvals are removed here, and a copy is saved in data/archive."
                )
              ) {
                void onClear();
              }
            }}
          >
            Clear
          </Button>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {messages.filter((m) => m.role !== "system" || visibleSystem(m)).length === 0 ? (
          <EmptyChat conversation={conversation} members={members} onSend={onSend} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message) => (
              <MessageBlock
                key={message.id}
                message={message}
                store={store}
                onApproval={onApproval}
                onOpenFile={onOpenFile}
                busy={busy}
              />
            ))}
            {busy ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Working on the computer…
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <Composer
        members={members}
        skills={store.skills}
        busy={busy}
        onSend={onSend}
        onStop={onStop}
        group={conversation.kind === "group"}
      />
    </div>
  );
}

function visibleSystem(message: Message) {
  return message.parts.some((p) => p.type === "text" && p.text.length > 0);
}

function providerLabel(store: Store, bot: Bot) {
  const p = store.providers.find((x) => x.id === bot.providerId);
  if (!p) return bot.model;
  if (p.kind === "demo") return "demo model";
  return `${p.name} · ${bot.model}`;
}

export function MessageBlock({
  message,
  store,
  onApproval,
  onOpenFile,
  busy,
}: {
  message: Message;
  store: Store;
  onApproval: (id: string, decision: "approved" | "denied") => Promise<void>;
  onOpenFile: (path: string) => void;
  busy: boolean;
}) {
  if (message.role === "user") {
    const text = message.parts.find((p) => p.type === "text");
    const atts = message.parts.filter((p): p is Extract<MessagePart, { type: "attachment" }> => p.type === "attachment");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
          {text ? <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text.text}</div> : null}
          {atts.map((a) => (
            <button
              key={a.path}
              type="button"
              onClick={() => onOpenFile(a.path)}
              className="mt-2 flex items-center gap-1.5 text-xs opacity-90 hover:opacity-100"
            >
              <Paperclip className="size-3" />
              {a.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (message.role === "system") {
    const text = message.parts.find((p) => p.type === "text");
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
        {text?.text}
      </div>
    );
  }

  const bot = store.bots.find((b) => b.id === message.botId);
  const toolCount = message.parts.filter((part) => part.type === "tool").length;
  return (
    <div className="flex gap-3">
      {bot ? <BotAvatar bot={bot} /> : <div className="size-9 rounded-full bg-muted" />}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-sm font-semibold">{bot?.name || "Bot"}</span>
          <span className="text-[11px] text-muted-foreground">{bot?.job}</span>
        </div>
        {toolCount > 0 ? (
          <div className="mb-1 text-[11px] text-muted-foreground">
            {toolCount} tool call{toolCount === 1 ? "" : "s"}
          </div>
        ) : null}
        <div className="space-y-2">
          {message.parts.map((part, i) => (
            <PartView
              key={i}
              part={part}
              store={store}
              onApproval={onApproval}
              onOpenFile={onOpenFile}
              busy={busy}
            />
          ))}
        </div>
        {message.reactions.length > 0 ? (
          <div className="mt-1 flex gap-1">
            {message.reactions.map((r) => (
              <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {r}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1 flex gap-1">
          {["👍", "👀", "🎯"].map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              onClick={() => mutate({ op: "react", messageId: message.id, emoji })}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PartView({
  part,
  store,
  onApproval,
  onOpenFile,
  busy,
}: {
  part: MessagePart;
  store: Store;
  onApproval: (id: string, decision: "approved" | "denied") => Promise<void>;
  onOpenFile: (path: string) => void;
  busy: boolean;
}) {
  if (part.type === "text") return <Markdown text={part.text} />;
  if (part.type === "tool") {
    return (
      <details className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
          {part.status === "running" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-primary" />}
          <span className="font-mono">{part.name}</span>
          <span className="text-muted-foreground">{part.status === "running" ? "running" : "done"}</span>
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
          {JSON.stringify(part.args, null, 2)}
          {part.result ? `\n\n${part.result}` : ""}
        </pre>
      </details>
    );
  }
  if (part.type === "approval") {
    const takeover = part.kind === "takeover";
    const send = part.kind === "send";
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="text-sm font-medium">{part.title}</div>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-xs whitespace-pre-wrap">
          {part.detail || part.command}
        </pre>
        {part.status === "pending" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onApproval(part.id, "approved")}>
              {takeover ? "I'm signed in — continue" : send ? "Send" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onApproval(part.id, "denied")}>
              {takeover ? "Stop" : send ? "Don't send" : "Deny"}
            </Button>
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">
            {part.status === "approved"
              ? takeover
                ? "You're back. The Bot will pick up from the current page."
                : send
                  ? "Approved — the click went through."
                  : "Approved — ran on the computer."
              : "Denied. The Bot will not do that."}
          </div>
        )}
      </div>
    );
  }
  if (part.type === "handoff") {
    const from = store.bots.find((b) => b.id === part.fromBotId)?.name;
    const to = store.bots.find((b) => b.id === part.toBotId)?.name;
    return (
      <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        {from} handed this to {to}: {part.note}
      </div>
    );
  }
  if (part.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onOpenFile(part.path)}
        className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        <FileText className="size-4 text-primary" />
        <span>
          {part.action === "created" ? "Created" : part.action === "updated" ? "Updated" : "Read"}{" "}
          <span className="font-mono text-xs">{part.path}</span>
        </span>
      </button>
    );
  }
  if (part.type === "attachment") {
    return (
      <button type="button" onClick={() => onOpenFile(part.path)} className="text-xs text-primary">
        {part.name}
      </button>
    );
  }
  return null;
}

function EmptyChat({
  conversation,
  members,
  onSend,
}: {
  conversation: Conversation;
  members: Bot[];
  onSend: (text: string) => Promise<boolean | void>;
}) {
  const suggestions =
    conversation.kind === "group"
      ? [
          "Open LinkedIn in the shared browser. I'll take over to log in, then you draft — don't send without me.",
          "@Scout gather current sources on local agent runtimes. @Quill turn that into a hold-for-approval brief.",
        ]
      : members[0]?.job.toLowerCase().includes("engineer")
        ? ["List the computer, add scripts/hello.py, and run it.", "Write a small Python script that prints the workspace files."]
        : members[0]?.job.toLowerCase().includes("research")
          ? ["Research local-first AI agents and save a sourced brief on the computer.", "/source-backed-research What can AI teammates on your own computer actually do?"]
          : members[0]?.job.toLowerCase().includes("writer")
            ? ["Draft a status update in a dry, direct voice and save it under drafts/.", "/draft-and-hold Announce that Homestead is running locally with a model picker."]
            : [
                "Stand up a morning briefing routine for this team. Don't send anything.",
                "Who should own research vs drafting, and how do we keep me out of the middle?",
              ];

  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-10">
      <div className="flex gap-2">
        {members.slice(0, 4).map((m) => (
          <BotAvatar key={m.id} bot={m} size="lg" />
        ))}
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{conversation.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Message like a teammate. Lead with the finish line, what they may change, and what needs your approval.
          Work happens on the shared computer — not as a chat draft.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSend(s)}
            className="rounded-xl border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Composer({
  members,
  skills,
  busy,
  onSend,
  onStop,
  group,
}: {
  members: Bot[];
  skills: Skill[];
  busy: boolean;
  onSend: (text: string, extras?: { mentions?: string[]; skillId?: string; files?: File[] }) => Promise<boolean | void>;
  onStop: () => void;
  group: boolean;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const mentions = useMemo(() => {
    const at = text.match(/@(\w*)$/);
    if (!at) return [];
    return members.filter((m) => m.name.toLowerCase().startsWith(at[1].toLowerCase()));
  }, [text, members]);

  const skillHits = useMemo(() => {
    const m = text.match(/^\/([a-z0-9-]*)$/i);
    if (!m) return [];
    return skills.filter((s) => s.slug.startsWith(m[1].toLowerCase()) || s.name.toLowerCase().includes(m[1].toLowerCase()));
  }, [text, skills]);

  const mentionOpen = mentions.length > 0;
  const skillOpen = skillHits.length > 0;

  async function submit() {
    const value = text.trim();
    if (!value && files.length === 0) return;
    if (busy) return;
    const mentioned = members.filter((m) => new RegExp(`@${m.name}\\b`, "i").test(value)).map((m) => m.id);
    const skill = skills.find((s) => value.startsWith(`/${s.slug}`));
    const sentText = text;
    const sentFiles = files;
    setText("");
    setFiles([]);
    const sent = await onSend(value || "Please look at the attached file.", {
      mentions: mentioned,
      skillId: skill?.id,
      files: sentFiles,
    });
    if (sent === false) {
      setText((current) => (current === "" ? sentText : current));
      setFiles((current) => (current.length === 0 ? sentFiles : current));
    }
  }

  return (
    <div className="border-t p-3">
      <div className="mx-auto max-w-3xl">
        {files.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <span key={f.name} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                {f.name}
                <button type="button" onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="relative rounded-2xl border bg-input/20 focus-within:border-ring">
          {mentionOpen ? (
            <Palette
              items={mentions.map((m) => ({ id: m.id, label: `@${m.name}`, hint: m.job }))}
              onPick={(id) => {
                const bot = members.find((m) => m.id === id);
                setText((t) => t.replace(/@\w*$/, `@${bot?.name} `));
              }}
            />
          ) : null}
          {skillOpen ? (
            <Palette
              items={skillHits.map((s) => ({ id: s.id, label: `/${s.slug}`, hint: s.name }))}
              onPick={(id) => {
                const skill = skills.find((s) => s.id === id);
                setText(`/${skill?.slug} `);
              }}
            />
          ) : null}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={group ? "Write normally, @mention a Bot, or / a skill" : "Give them a finish line…"}
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-10 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                setFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
                e.currentTarget.value = "";
              }}
            />
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Attach a file">
              <Paperclip className="size-4" />
            </Button>
            {busy ? (
              <Button type="button" size="icon-sm" variant="secondary" onClick={onStop} title="Stop">
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button type="button" size="icon-sm" onClick={() => void submit()} disabled={!text.trim() && files.length === 0}>
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          {busy
            ? "Wait for the Bot to finish, or press Stop."
            : "Enter to send · Shift+Enter for a newline · Consequential actions wait for approval"}
        </p>
      </div>
    </div>
  );
}

function Palette({
  items,
  onPick,
}: {
  items: { id: string; label: string; hint: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="absolute inset-x-2 bottom-full mb-1 overflow-hidden rounded-xl border bg-popover shadow-lg">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item.id)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
        >
          <span className="font-mono">{item.label}</span>
          <span className="text-xs text-muted-foreground">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
