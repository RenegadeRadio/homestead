import { nid, nowIso } from "@/lib/ids";
import { anthropicComplete, openaiComplete } from "@/lib/agent/providers";
import { anthropicTools, openaiTools } from "@/lib/agent/tools";
import { buildSystemPrompt, mentionedBots, routeOwner, skillBySlash } from "@/lib/agent/prompt";
import { executeApprovedAction, executeTool } from "@/lib/agent/execute";
import {
  DEFAULT_TOOL_BUDGET_PER_TURN,
  toolBudgetText,
} from "@/lib/agent/tool-budget";
import { runDemoBot } from "@/lib/agent/demo";
import { runClaudeCodeTurn } from "@/lib/agent/claude-code";
import { persistEmit } from "@/lib/sse";
import { getStore, persistStore, updateStore } from "@/lib/store";
import { syncPendingSends } from "@/lib/crm/notion-sync";
import type {
  Bot,
  Conversation,
  CrewEvent,
  LlmMessage,
  MessagePart,
  Store,
} from "@/lib/types";

const inflight = new Map<string, AbortController>();
const resolvingApprovals = new Set<string>();

export function stopConversation(conversationId: string) {
  inflight.get(conversationId)?.abort();
  inflight.delete(conversationId);
}

function findMessage(store: Store, id: string) {
  return store.messages.find((m) => m.id === id);
}

async function completeWithProvider(
  bot: Bot,
  store: Store,
  messages: LlmMessage[],
  signal: AbortSignal
) {
  const provider = store.providers.find((p) => p.id === bot.providerId);
  if (!provider || provider.kind === "demo") {
    return null;
  }
  if (provider.kind === "anthropic") {
    if (!provider.apiKey) throw new Error("Add an Anthropic API key in Settings.");
    return anthropicComplete({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: bot.model || provider.defaultModel,
      messages,
      tools: anthropicTools(),
      signal,
    });
  }
  if (!provider.apiKey && !/localhost|127\.0\.0\.1/i.test(provider.baseUrl)) {
    throw new Error(`Add an API key for ${provider.name} in Settings, or switch this Bot to the demo model.`);
  }
  return openaiComplete({
    baseUrl: provider.baseUrl || "https://api.openai.com/v1",
    apiKey: provider.apiKey,
    model: bot.model || provider.defaultModel,
    messages,
    tools: openaiTools(),
    signal,
  });
}

async function runBotLoop(opts: {
  store: Store;
  bot: Bot;
  conversation: Conversation;
  userText: string;
  extra?: string;
  emit: (e: CrewEvent) => void;
  signal: AbortSignal;
  depth: number;
  resume?: { checkpoint: LlmMessage[]; messageId: string };
}) {
  const { store, bot, conversation, emit, signal } = opts;
  if (opts.depth > 3) return;
  if (signal.aborted) return;

  const messageId = opts.resume?.messageId || nid("msg");
  let message = findMessage(store, messageId);
  if (!message) {
    message = {
      id: messageId,
      conversationId: conversation.id,
      role: "assistant",
      botId: bot.id,
      parts: [],
      createdAt: nowIso(),
      reactions: [],
    };
    store.messages.push(message);
  }
  emit({ type: "bot_start", botId: bot.id, messageId });
  const out = persistEmit(message, emit);

  const provider = store.providers.find((p) => p.id === bot.providerId);
  const useDemo = !provider || provider.kind === "demo";

  if (useDemo && !opts.resume) {
    const demo = await runDemoBot({
      store,
      bot,
      userText: opts.userText,
      conversationId: conversation.id,
      messageId,
      emit: out,
      extra: opts.extra,
    });
    for (const handoff of demo.handoffs) {
      out({
        type: "handoff",
        botId: bot.id,
        messageId,
        fromBotId: bot.id,
        toBotId: handoff.toBotId,
        note: handoff.note,
      });
      const next = store.bots.find((b) => b.id === handoff.toBotId);
      if (next) {
        await runBotLoop({
          store,
          bot: next,
          conversation,
          userText: handoff.note,
          extra: `Handoff from ${bot.name}.`,
          emit,
          signal,
          depth: opts.depth + 1,
        });
      }
    }
    return;
  }

  if (provider?.kind === "claude-code") {
    await runClaudeCodeTurn({
      store,
      bot,
      provider,
      conversationId: conversation.id,
      messageId,
      prompt: opts.userText,
      extra: opts.extra,
      emit: out,
      signal,
      onHandoff: async (toBotId, note) => {
        out({
          type: "handoff",
          botId: bot.id,
          messageId,
          fromBotId: bot.id,
          toBotId,
          note,
        });
        const next = store.bots.find((candidate) => candidate.id === toBotId);
        if (next) {
          await runBotLoop({
            store,
            bot: next,
            conversation,
            userText: note,
            extra: `Handoff from ${bot.name}.`,
            emit,
            signal,
            depth: opts.depth + 1,
          });
        }
      },
    });
    return;
  }

  const llmMessages: LlmMessage[] = opts.resume?.checkpoint?.length
    ? opts.resume.checkpoint
    : [
        { role: "system", content: buildSystemPrompt(bot, store, opts.extra) },
        { role: "user", content: opts.userText },
      ];
  const toolBudget = store.settings.toolBudgetPerTurn ?? DEFAULT_TOOL_BUDGET_PER_TURN;
  let toolCallCount = 0;
  let budgetLogged = false;

  for (let round = 0; round < 10; round++) {
    if (signal.aborted) throw new Error("Stopped.");
    let completion;
    try {
      completion = await completeWithProvider(bot, store, llmMessages, signal);
    } catch (error) {
      if (signal.aborted) throw new Error("Stopped.");
      throw error;
    }
    if (!completion) break;

    if (completion.tool_calls.length) {
      llmMessages.push({
        role: "assistant",
        content: completion.content,
        tool_calls: completion.tool_calls,
      });
      if (completion.content) {
        out({ type: "text_delta", botId: bot.id, messageId, text: completion.content + "\n" });
      }
      for (const call of completion.tool_calls) {
        const toolId = call.id || nid("tool");
        if (toolCallCount >= toolBudget) {
          const budgetText = toolBudgetText(toolBudget);
          if (!budgetLogged) {
            budgetLogged = true;
            store.computerLogs.unshift({
              id: nid("log"),
              at: nowIso(),
              botId: bot.id,
              kind: "browser",
              summary: `Tool budget reached: ${bot.name}, ${toolBudget} calls`,
            });
          }
          llmMessages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: budgetText,
          });
          continue;
        }
        toolCallCount += 1;
        out({
          type: "tool_start",
          botId: bot.id,
          messageId,
          toolId,
          name: call.name,
          args: call.arguments,
        });
        const outcome = await executeTool(call.name, call.arguments, {
          store,
          bot,
          conversationId: conversation.id,
          messageId,
        });
        const toolPart = message.parts.find((p) => p.type === "tool" && p.id === toolId);
        if (outcome.approval) {
          outcome.approval.checkpoint = [
            ...llmMessages,
            {
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: "User has been asked to approve this command. Wait for the result.",
            },
          ];
          store.pendingApprovals.push(outcome.approval);
          await persistStore();
          if (toolPart && toolPart.type === "tool") {
            toolPart.status = "awaiting_approval";
            toolPart.result = outcome.result;
          }
          const approvalPart: MessagePart = {
            type: "approval",
            id: outcome.approval.id,
            title: outcome.approval.title || "Needs you",
            detail: String(
              outcome.approval.args.command ||
                outcome.approval.args.reason ||
                outcome.result
            ),
            command: String(outcome.approval.args.command || ""),
            kind: outcome.approval.kind,
            status: "pending",
          };
          out({ type: "approval", botId: bot.id, messageId, approval: approvalPart });
          out({
            type: "paused",
            reason: outcome.approval.kind === "takeover" ? "takeover" : "approval",
            approvalId: outcome.approval.id,
          });
          return;
        }
        out({
          type: "tool_end",
          botId: bot.id,
          messageId,
          toolId,
          result: outcome.result.slice(0, 4000),
          status: "done",
        });
        if (outcome.file) {
          out({
            type: "file",
            botId: bot.id,
            messageId,
            path: outcome.file.path,
            action: outcome.file.action,
          });
        }
        llmMessages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: outcome.result.slice(0, 12_000),
        });
        if (outcome.handoff) {
          out({
            type: "handoff",
            botId: bot.id,
            messageId,
            fromBotId: bot.id,
            toBotId: outcome.handoff.toBotId,
            note: outcome.handoff.note,
          });
          const next = store.bots.find((b) => b.id === outcome.handoff!.toBotId);
          if (next) {
            await runBotLoop({
              store,
              bot: next,
              conversation,
              userText: outcome.handoff.note,
              extra: `Handoff from ${bot.name}.`,
              emit,
              signal,
              depth: opts.depth + 1,
            });
          }
        }
      }
      continue;
    }

    const text = completion.content || "(no response)";
    const chunks = text.match(/[\s\S]{1,40}/g) || [text];
    for (const chunk of chunks) {
      out({ type: "text_delta", botId: bot.id, messageId, text: chunk });
    }
    break;
  }
}

function conversationHistoryText(store: Store, conversationId: string) {
  return store.messages
    .filter((m) => m.conversationId === conversationId && m.role !== "system")
    .slice(-12)
    .map((m) => {
      const text = m.parts
        .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      const who = m.role === "user" ? "User" : store.bots.find((b) => b.id === m.botId)?.name || "Bot";
      return `${who}: ${text}`;
    })
    .filter((line) => line.trim().length > 6)
    .join("\n");
}

export async function handleUserMessage(opts: {
  conversationId: string;
  text: string;
  mentions?: string[];
  skillId?: string;
  attachments?: { name: string; path: string }[];
  emit: (e: CrewEvent) => void;
}) {
  const controller = new AbortController();
  inflight.get(opts.conversationId)?.abort();
  inflight.set(opts.conversationId, controller);

  try {
    const store = await getStore();
    try {
      const conversation = store.conversations.find((c) => c.id === opts.conversationId);
      if (!conversation) throw new Error("Conversation not found.");

      const skill = opts.skillId
        ? store.skills.find((s) => s.id === opts.skillId)
        : skillBySlash(opts.text, store.skills)?.skill;
      const slash = skillBySlash(opts.text, store.skills);
      const userText = slash ? slash.rest || `Run skill /${slash.skill.slug}` : opts.text;

      const parts: MessagePart[] = [{ type: "text", text: opts.text }];
      for (const att of opts.attachments || []) {
        parts.push({ type: "attachment", name: att.name, path: att.path });
      }
      store.messages.push({
        id: nid("msg"),
        conversationId: conversation.id,
        role: "user",
        parts,
        createdAt: nowIso(),
        reactions: [],
      });
      conversation.updatedAt = nowIso();
      await persistStore();

      const members = store.bots.filter((b) => conversation.botIds.includes(b.id) && !b.archived);
      const mentioned = [
        ...new Set([...(opts.mentions || []), ...mentionedBots(opts.text, members)]),
      ].filter((id) => conversation.botIds.includes(id));

      let owners: Bot[] = [];
      if (mentioned.length) {
        owners = members.filter((b) => mentioned.includes(b.id));
      } else if (conversation.kind === "dm") {
        owners = members.slice(0, 1);
      } else {
        const routed = routeOwner(userText, members);
        owners = routed ? [routed] : members.slice(0, 1);
      }

      const extra = [
        skill ? `The user invoked skill /${skill.slug}:\n${skill.body}` : "",
        opts.attachments?.length
          ? `Attached files on the computer:\n${opts.attachments.map((a) => a.path).join("\n")}`
          : "",
        conversationHistoryText(store, conversation.id),
      ]
        .filter(Boolean)
        .join("\n\n");

      for (const bot of owners) {
        await runBotLoop({
          store,
          bot,
          conversation,
          userText,
          extra,
          emit: opts.emit,
          signal: controller.signal,
          depth: 0,
        });
      }
    } finally {
      await persistStore();
    }
    opts.emit({ type: "done" });
  } catch (err) {
    opts.emit({
      type: "error",
      message: err instanceof Error ? err.message : "The turn failed.",
    });
    opts.emit({ type: "done" });
  } finally {
    inflight.delete(opts.conversationId);
  }
}

export async function resolveApproval(opts: {
  approvalId: string;
  decision: "approved" | "denied";
  emit: (e: CrewEvent) => void;
}) {
  if (resolvingApprovals.has(opts.approvalId)) {
    opts.emit({ type: "error", message: "This approval is already being handled." });
    opts.emit({ type: "done" });
    return;
  }
  resolvingApprovals.add(opts.approvalId);
  const controller = new AbortController();
  try {
    const pending = (await getStore()).pendingApprovals.find((a) => a.id === opts.approvalId);
    if (pending) {
      inflight.set(pending.conversationId, controller);
    }
    const store = await getStore();
    try {
      await (async () => {
      const approval = store.pendingApprovals.find((a) => a.id === opts.approvalId);
      if (!approval) throw new Error("No pending approval.");
      const conversation = store.conversations.find((c) => c.id === approval.conversationId);
      const bot = store.bots.find((b) => b.id === approval.botId);
      const message = store.messages.find((m) => m.id === approval.messageId);
      if (!conversation || !bot || !message) throw new Error("Approval context missing.");

      const card = message.parts.find((p) => p.type === "approval" && p.id === approval.id);
      const newerMessage =
        opts.decision === "approved" &&
        store.messages.find(
          (item) =>
            item.conversationId === approval.conversationId &&
            item.role === "assistant" &&
            item.botId === approval.botId &&
            item.id !== approval.messageId &&
            item.createdAt > approval.createdAt
        );
      if (newerMessage) {
        if (card && card.type === "approval") card.status = "denied";
        store.pendingApprovals = store.pendingApprovals.filter((a) => a.id !== approval.id);
        throw new Error(
          `This request is out of date: ${bot.name} has started newer work. Ask again if it is still needed.`
        );
      }
      if (card && card.type === "approval") card.status = opts.decision;

      let result = "The user denied this action. Continue with a different approach; do not retry it.";
      if (opts.decision === "approved") {
        result = await executeApprovedAction(approval, bot, store);
      }

      store.pendingApprovals = store.pendingApprovals.filter((a) => a.id !== approval.id);
      await persistStore();

      emitToolEnd(opts.emit, bot.id, message.id, result);

      if (opts.decision === "denied") {
        message.parts.push({
          type: "text",
          text: "Understood. I won't run that. Tell me how you want to proceed.",
        });
        opts.emit({
          type: "text_delta",
          botId: bot.id,
          messageId: message.id,
          text: "Understood. I won't run that. Tell me how you want to proceed.",
        });
        return;
      }

      const provider = store.providers.find((p) => p.id === bot.providerId);
      if (provider?.kind === "claude-code") {
        const prompt = `The operator approved your \`${approval.toolName}\` call. Its result follows. Continue the task.\n\n${result.slice(0, 12_000)}`;
        const out = persistEmit(message, opts.emit);
        await runClaudeCodeTurn({
          store,
          bot,
          provider,
          conversationId: conversation.id,
          messageId: message.id,
          prompt,
          resumeSessionId: approval.resumeSessionId,
          emit: out,
          signal: controller.signal,
          onHandoff: async (toBotId, note) => {
            out({
              type: "handoff",
              botId: bot.id,
              messageId: message.id,
              fromBotId: bot.id,
              toBotId,
              note,
            });
            const next = store.bots.find((candidate) => candidate.id === toBotId);
            if (next) {
              await runBotLoop({
                store,
                bot: next,
                conversation,
                userText: note,
                extra: `Handoff from ${bot.name}.`,
                emit: opts.emit,
                signal: controller.signal,
                depth: 1,
              });
            }
          },
        });
        return;
      }
      if (!provider || provider.kind === "demo") {
        const summary =
          approval.kind === "takeover"
            ? `You're done with the human step. Here's the page:\n\n${result.slice(0, 2500)}`
            : approval.kind === "send"
              ? "Sent, or the click went through. Check Computer → Browser."
              : `Done on the computer.\n\n${result.slice(0, 1200)}`;
        message.parts.push({ type: "text", text: summary });
        opts.emit({
          type: "text_delta",
          botId: bot.id,
          messageId: message.id,
          text: summary,
        });
        return;
      }

      const checkpoint: LlmMessage[] = [
        ...approval.checkpoint,
        {
          role: "tool",
          tool_call_id: approval.checkpoint.find((m) => m.role === "assistant")?.tool_calls?.[0]?.id || "tool",
          content: result.slice(0, 12_000),
        },
      ];
      await runBotLoop({
        store,
        bot,
        conversation,
        userText: "Continue after the approved command.",
        emit: opts.emit,
        signal: controller.signal,
        depth: 0,
        resume: { checkpoint, messageId: message.id },
      });
      })();
    } finally {
      await persistStore();
    }
    try {
      await syncPendingSends({ fetchFn: fetch, env: process.env });
    } catch {
      // CRM availability must never change the result of an approved action.
    }
    opts.emit({ type: "done" });
  } catch (err) {
    opts.emit({
      type: "error",
      message: err instanceof Error ? err.message : "Approval failed.",
    });
    opts.emit({ type: "done" });
  } finally {
    resolvingApprovals.delete(opts.approvalId);
  }
}

function emitToolEnd(emit: (e: CrewEvent) => void, botId: string, messageId: string, result: string) {
  emit({
    type: "tool_end",
    botId,
    messageId,
    toolId: nid("tool"),
    result: result.slice(0, 4000),
    status: "done",
  });
}

export async function runRoutineNow(routineId: string, emit: (e: CrewEvent) => void) {
  const store = await getStore();
  const routine = store.routines.find((r) => r.id === routineId);
  if (!routine) throw new Error("Routine not found.");
  const skill = routine.skillId ? store.skills.find((s) => s.id === routine.skillId) : undefined;
  const text = [routine.prompt, skill ? `Follow /${skill.slug}` : ""].filter(Boolean).join("\n\n");
  await handleUserMessage({
    conversationId: routine.conversationId,
    text: text || `Run routine ${routine.name}`,
    skillId: routine.skillId,
    emit,
  });
  await updateStore((s) => {
    const r = s.routines.find((x) => x.id === routineId);
    if (r) r.lastRunAt = nowIso();
  });
}
