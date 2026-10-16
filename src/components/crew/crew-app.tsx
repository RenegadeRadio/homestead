"use client";

import { useEffect, useState } from "react";
import { Menu, Monitor, PanelRight } from "lucide-react";
import { toast } from "sonner";

import { ChatPane } from "@/components/crew/chat";
import { ComputerPane } from "@/components/crew/computer";
import { NewBotDialog, NewGroupDialog, RoutinesPane, SettingsPane, SkillsPane } from "@/components/crew/panels";
import { OutboxPane } from "@/components/crew/outbox-pane";
import { Sidebar } from "@/components/crew/sidebar";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCrew } from "@/hooks/use-crew";
import { mutate, sendOutbox } from "@/lib/client";
import type { MutateOp } from "@/lib/ops";
import type { Bot } from "@/lib/types";

export async function clearCurrentConversation(
  conversationId: string | null,
  runMutate: (op: MutateOp) => Promise<unknown>,
  notify: { success: (text: string) => void; error: (text: string) => void }
) {
  if (!conversationId) return;

  try {
    await runMutate({ op: "clearConversation", id: conversationId });
    notify.success("Chat cleared. A copy was saved.");
  } catch (err) {
    notify.error(
      `Could not clear the chat: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function CrewApp() {
  const crew = useCrew();
  const [botOpen, setBotOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (crew.error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {crew.error}
      </div>
    );
  }

  if (!crew.store) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Waking the shared computer…
      </div>
    );
  }

  const sidebar = (
    <Sidebar
      store={crew.store}
      view={crew.view}
      conversationId={crew.conversationId}
      onView={crew.setView}
      onConversation={crew.openConversation}
      onNewBot={() => setBotOpen(true)}
      onNewGroup={() => setGroupOpen(true)}
      onSearch={() => setPalette(true)}
      onClose={() => setMobileNav(false)}
    />
  );

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <aside className="hidden w-[280px] shrink-0 border-r md:block">{sidebar}</aside>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-[280px] p-0 sm:max-w-[280px]">
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b px-2 py-1.5 md:hidden">
          <Button size="icon-sm" variant="ghost" onClick={() => setMobileNav(true)}>
            <Menu className="size-4" />
          </Button>
          <div className="text-sm font-medium">Homestead</div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => crew.setComputerOpen((v) => !v)}
          >
            <Monitor className="size-4" />
          </Button>
        </div>

        {crew.view === "chat" && crew.conversation ? (
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <ChatPane
                store={crew.store}
                conversation={crew.conversation}
                messages={crew.messages}
                busy={crew.busy}
                onSend={crew.send}
                onApproval={crew.approval}
                onOpenFile={(path) => {
                  crew.setFilePath(path);
                  crew.setComputerOpen(true);
                }}
                onStop={() => {
                  if (crew.conversationId) void mutate({ op: "stop", conversationId: crew.conversationId });
                }}
                onClear={() => clearCurrentConversation(crew.conversationId, crew.runMutate, toast)}
              />
            </div>
            <div className={`hidden shrink-0 border-l lg:block ${crew.computerOpen ? "w-[400px]" : "w-10"}`}>
              {crew.computerOpen ? (
                <ComputerPane
                  store={crew.store}
                  tree={crew.tree}
                  selected={crew.filePath}
                  onSelect={crew.setFilePath}
                  compact
                  preferTab={
                    crew.store.pendingApprovals.some((a) => a.kind === "takeover") ? "browser" : undefined
                  }
                />
              ) : (
                <button
                  type="button"
                  className="flex h-full w-full items-start justify-center pt-3 text-muted-foreground hover:text-foreground"
                  onClick={() => crew.setComputerOpen(true)}
                  title="Show computer"
                >
                  <PanelRight className="size-4" />
                </button>
              )}
            </div>
          </div>
        ) : crew.view === "computer" ? (
          <ComputerPane
            store={crew.store}
            tree={crew.tree}
            selected={crew.filePath}
            onSelect={crew.setFilePath}
            preferTab={crew.store.pendingApprovals.some((a) => a.kind === "takeover") ? "browser" : undefined}
          />
        ) : crew.view === "skills" ? (
          <div className="flex-1 overflow-y-auto">
            <SkillsPane store={crew.store} mutateAndRefresh={crew.runMutate} />
          </div>
        ) : crew.view === "routines" ? (
          <div className="flex-1 overflow-y-auto">
            <RoutinesPane
              store={crew.store}
              mutateAndRefresh={crew.runMutate}
              onOpenConversation={crew.openConversation}
            />
          </div>
        ) : crew.view === "outbox" ? (
          <div className="flex-1 overflow-y-auto">
            <OutboxPane
              store={crew.store}
              mutateAndRefresh={crew.runMutate}
              onSend={async () => {
                const result = await sendOutbox();
                await crew.refresh();
                return result;
              }}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SettingsPane store={crew.store} mutateAndRefresh={crew.runMutate} />
          </div>
        )}
      </main>

      <NewBotDialog
        open={botOpen}
        onOpenChange={setBotOpen}
        store={crew.store}
        mutateAndRefresh={crew.runMutate}
        onCreated={(bot: Bot) => crew.openBot(bot)}
      />
      <NewGroupDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        store={crew.store}
        mutateAndRefresh={crew.runMutate}
        onCreated={(id) => crew.openConversation(id)}
      />

      <CommandDialog open={palette} onOpenChange={setPalette} title="Jump" description="Find a Bot, group, skill, or file">
        <CommandInput placeholder="Jump to a Bot, group, skill, or file…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Bots">
            {crew.store.bots
              .filter((b) => !b.archived)
              .map((bot) => (
                <CommandItem
                  key={bot.id}
                  onSelect={() => {
                    crew.openBot(bot);
                    setPalette(false);
                  }}
                >
                  {bot.emoji} {bot.name}
                  <span className="ml-auto text-xs text-muted-foreground">{bot.job}</span>
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandGroup heading="Groups">
            {crew.store.conversations
              .filter((c) => c.kind === "group")
              .map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => {
                    crew.openConversation(c.id);
                    setPalette(false);
                  }}
                >
                  {c.title}
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandGroup heading="Skills">
            {crew.store.skills.map((s) => (
              <CommandItem
                key={s.id}
                onSelect={() => {
                  crew.setView("skills");
                  setPalette(false);
                }}
              >
                /{s.slug}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
