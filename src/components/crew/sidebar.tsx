"use client";

import {
  FolderTree,
  Inbox,
  Monitor,
  Plus,
  Repeat,
  Search,
  Send,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";

import { BotAvatar } from "@/components/crew/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { View } from "@/hooks/use-crew";
import type { Bot, Conversation, Store } from "@/lib/types";

export function Sidebar({
  store,
  view,
  conversationId,
  onView,
  onConversation,
  onNewBot,
  onNewGroup,
  onSearch,
  onClose,
}: {
  store: Store;
  view: View;
  conversationId: string | null;
  onView: (view: View) => void;
  onConversation: (id: string) => void;
  onNewBot: () => void;
  onNewGroup: () => void;
  onSearch: () => void;
  onClose?: () => void;
}) {
  const bots = store.bots.filter((b) => !b.archived);
  const dms = store.conversations.filter((c) => c.kind === "dm");
  const groups = store.conversations.filter((c) => c.kind === "group");

  const navBtn = (id: View, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => {
        onView(id);
        onClose?.();
      }}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
        view === id ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">Homestead</div>
          <div className="text-[11px] text-muted-foreground">AI teammates, on your computer</div>
        </div>
      </div>

      <div className="px-2 pb-2">
        <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={onSearch}>
          <Search className="size-3.5" />
          Search
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/80">⌘K</span>
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="space-y-0.5 pb-2">
          {navBtn("computer", "Computer", <Monitor className="size-3.5" />)}
          {navBtn("skills", "Skills", <FolderTree className="size-3.5" />)}
          {navBtn("routines", "Routines", <Repeat className="size-3.5" />)}
          {navBtn("outbox", "Outbox", <Send className="size-3.5" />)}
          {navBtn("comms", "Comms", <Inbox className="size-3.5" />)}
        </div>

        <Section
          title="Bots"
          action={
            <button type="button" onClick={onNewBot} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              <Plus className="size-3.5" />
            </button>
          }
        >
          {bots.map((bot) => {
            const dm = dms.find((c) => c.botIds[0] === bot.id);
            return (
              <ConversationRow
                key={bot.id}
                active={view === "chat" && conversationId === dm?.id}
                onClick={() => {
                  if (dm) onConversation(dm.id);
                  onClose?.();
                }}
                leading={<BotAvatar bot={bot} size="sm" />}
                title={bot.name}
                subtitle={bot.job}
              />
            );
          })}
        </Section>

        <Section
          title="Groups"
          action={
            <button type="button" onClick={onNewGroup} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              <Plus className="size-3.5" />
            </button>
          }
        >
          {groups.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">Create a group when several Bots share one outcome.</p>
          ) : (
            groups.map((group) => (
              <ConversationRow
                key={group.id}
                active={view === "chat" && conversationId === group.id}
                onClick={() => {
                  onConversation(group.id);
                  onClose?.();
                }}
                leading={
                  <div className="flex size-7 items-center justify-center rounded-full bg-foreground/8">
                    <Users className="size-3.5" />
                  </div>
                }
                title={group.title}
                subtitle={memberNames(group, bots)}
              />
            ))
          )}
        </Section>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-2">
        {navBtn("settings", "Settings", <Settings2 className="size-3.5" />)}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 pb-1">
      <div className="flex items-center px-2 pb-1">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ConversationRow({
  active,
  onClick,
  leading,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
      }`}
    >
      {leading}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
    </button>
  );
}

function memberNames(group: Conversation, bots: Bot[]) {
  return bots
    .filter((b) => group.botIds.includes(b.id))
    .map((b) => b.name)
    .join(", ");
}
