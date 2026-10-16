"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  bootstrap,
  decideApproval,
  mutate,
  sendChat,
  uploadFile,
} from "@/lib/client";
import type { Bot, Conversation, CrewEvent, FileNode, Message, Store } from "@/lib/types";

export type View = "chat" | "computer" | "skills" | "routines" | "outbox" | "settings";

function applyEventToStore(store: Store, event: CrewEvent, conversationId: string): Store {
  const next = {
    ...store,
    messages: store.messages.map((m) => ({ ...m, parts: [...m.parts] })),
  };
  if (event.type === "bot_start") {
    if (!next.messages.some((m) => m.id === event.messageId)) {
      next.messages.push({
        id: event.messageId,
        conversationId,
        role: "assistant",
        botId: event.botId,
        parts: [],
        createdAt: new Date().toISOString(),
        reactions: [],
      });
    }
    return next;
  }
  const message = next.messages.find((m) => m.id === (event as { messageId?: string }).messageId);
  if (!message) return next;
  if (event.type === "text_delta") {
    const last = message.parts[message.parts.length - 1];
    if (last && last.type === "text") last.text += event.text;
    else message.parts.push({ type: "text", text: event.text });
  } else if (event.type === "tool_start") {
    message.parts.push({
      type: "tool",
      id: event.toolId,
      name: event.name,
      args: event.args,
      status: "running",
    });
  } else if (event.type === "tool_end") {
    const part = message.parts.find((p) => p.type === "tool" && p.id === event.toolId);
    if (part && part.type === "tool") {
      part.status = event.status;
      part.result = event.result;
    }
  } else if (event.type === "approval") {
    message.parts.push(event.approval);
  } else if (event.type === "handoff") {
    message.parts.push({
      type: "handoff",
      fromBotId: event.fromBotId,
      toBotId: event.toBotId,
      note: event.note,
    });
  } else if (event.type === "file") {
    message.parts.push({ type: "file", path: event.path, action: event.action });
  }
  return next;
}

export function useCrew() {
  const [store, setStore] = useState<Store | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [computerOpen, setComputerOpen] = useState(true);
  const [filePath, setFilePath] = useState<string | null>("README.md");
  const conversationIdRef = useRef(conversationId);
  const busyRef = useRef(busy);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const refresh = useCallback(async () => {
    const data = await bootstrap();
    setStore(data.store);
    if (data.store.pendingApprovals.some((a) => a.kind === "takeover")) setComputerOpen(true);
    setTree(data.tree);
    setConversationId((id) => id ?? data.store.conversations.find((c) => c.kind === "group")?.id ?? data.store.conversations[0]?.id ?? null);
    return data.store;
  }, []);

  useEffect(() => {
    let cancelled = false;
    bootstrap()
      .then((data) => {
        if (cancelled) return;
        setStore(data.store);
        if (data.store.pendingApprovals.some((a) => a.kind === "takeover")) setComputerOpen(true);
        setTree(data.tree);
        setConversationId(
          (id) =>
            id ??
            data.store.conversations.find((c) => c.kind === "group")?.id ??
            data.store.conversations[0]?.id ??
            null
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const conversation = useMemo(
    () => store?.conversations.find((c) => c.id === conversationId) || null,
    [store, conversationId]
  );

  const messages = useMemo(
    () => (store && conversationId ? store.messages.filter((m) => m.conversationId === conversationId) : []),
    [store, conversationId]
  );

  const botsById = useMemo(() => {
    const map = new Map<string, Bot>();
    for (const b of store?.bots || []) map.set(b.id, b);
    return map;
  }, [store]);

  const onEvent = useCallback((event: CrewEvent) => {
    if (event.type === "error") {
      toast.error(event.message);
      return;
    }
    if (event.type === "done" || event.type === "paused") {
      void refresh();
      return;
    }
    setStore((prev) => {
      if (!prev || !conversationIdRef.current) return prev;
      return applyEventToStore(prev, event, conversationIdRef.current);
    });
  }, [refresh]);

  async function send(
    text: string,
    extras?: { mentions?: string[]; skillId?: string; files?: File[] }
  ): Promise<boolean> {
    if (!conversationId || !text.trim() || busy) return false;
    setBusy(true);
    const attachments: { name: string; path: string }[] = [];
    try {
      for (const file of extras?.files || []) {
        attachments.push(await uploadFile(file));
      }
      const optimistic: Message = {
        id: `local_${Date.now()}`,
        conversationId,
        role: "user",
        parts: [
          { type: "text", text },
          ...attachments.map((a) => ({ type: "attachment" as const, name: a.name, path: a.path })),
        ],
        createdAt: new Date().toISOString(),
        reactions: [],
      };
      setStore((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
      await sendChat(
        {
          conversationId,
          text,
          mentions: extras?.mentions,
          skillId: extras?.skillId,
          attachments,
        },
        onEvent
      );
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed.");
      return false;
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function approval(id: string, decision: "approved" | "denied") {
    setBusy(true);
    try {
      await decideApproval(id, decision, onEvent);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function runMutate(...args: Parameters<typeof mutate>) {
    const result = await mutate(...args);
    await refresh();
    return result;
  }

  function openConversation(id: string) {
    setConversationId(id);
    setView("chat");
  }

  function openBot(bot: Bot) {
    const dm = store?.conversations.find((c) => c.kind === "dm" && c.botIds.length === 1 && c.botIds[0] === bot.id);
    if (dm) openConversation(dm.id);
  }

  return {
    store,
    tree,
    error,
    view,
    setView,
    conversation,
    conversationId,
    messages,
    botsById,
    busy,
    computerOpen,
    setComputerOpen,
    filePath,
    setFilePath,
    refresh,
    send,
    approval,
    runMutate,
    openConversation,
    openBot,
    conversations: (store?.conversations || []) as Conversation[],
  };
}
