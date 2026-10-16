import { executeTool } from "@/lib/agent/execute";
import { getTurn, type ClaudeCodeTurn } from "@/lib/agent/claude-code";
import {
  DEFAULT_TOOL_BUDGET_PER_TURN,
  toolBudgetText,
} from "@/lib/agent/tool-budget";
import { nid, nowIso } from "@/lib/ids";
import { guardLocalRequest } from "@/lib/local-request";
import type { MessagePart } from "@/lib/types";

export const dynamic = "force-dynamic";
export const PAUSED_TEXT =
  "Paused: the operator must approve this first. Do not call any more tools. End your turn now.";
const budgetLoggedTurns = new WeakSet<ClaudeCodeTurn>();

export async function POST(req: Request) {
  const refused = guardLocalRequest(req);
  if (refused) return refused;
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  const turn = match ? getTurn(match[1]) : undefined;
  if (!turn) return Response.json({ error: "Unknown turn token." }, { status: 403 });
  if (turn.paused) return Response.json({ result: PAUSED_TEXT });

  const budget = turn.store.settings.toolBudgetPerTurn ?? DEFAULT_TOOL_BUDGET_PER_TURN;
  if (turn.toolCalls >= budget) {
    if (!budgetLoggedTurns.has(turn)) {
      budgetLoggedTurns.add(turn);
      turn.store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: turn.bot.id,
        kind: "browser",
        summary: `Tool budget reached: ${turn.bot.name}, ${budget} calls`,
      });
    }
    return Response.json({
      result: toolBudgetText(budget),
    });
  }
  turn.toolCalls += 1;

  const body = (await req.json()) as { name?: string; arguments?: Record<string, unknown> };
  const name = body.name || "";
  const args = body.arguments || {};
  const toolId = nid("tool");
  turn.emit({
    type: "tool_start",
    botId: turn.bot.id,
    messageId: turn.messageId,
    toolId,
    name,
    args,
  });
  let outcome: Awaited<ReturnType<typeof executeTool>>;
  try {
    outcome = await executeTool(name, args, {
      store: turn.store,
      bot: turn.bot,
      conversationId: turn.conversationId,
      messageId: turn.messageId,
      extendTimeout: turn.extendDeadline,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const result = `Tool failed: ${detail}`;
    turn.emit({
      type: "tool_end",
      botId: turn.bot.id,
      messageId: turn.messageId,
      toolId,
      result,
      status: "error",
    });
    return Response.json({ result });
  }
  const message = turn.store.messages.find((item) => item.id === turn.messageId);
  const toolPart = message?.parts.find((part) => part.type === "tool" && part.id === toolId);
  if (outcome.approval) {
    outcome.approval.checkpoint = [];
    outcome.approval.resumeSessionId = turn.sessionId;
    turn.store.pendingApprovals.push(outcome.approval);
    if (toolPart?.type === "tool") {
      toolPart.status = "awaiting_approval";
      toolPart.result = outcome.result;
    }
    const approvalPart: MessagePart = {
      type: "approval",
      id: outcome.approval.id,
      title: outcome.approval.title || "Needs you",
      detail: String(
        outcome.approval.args.command || outcome.approval.args.reason || outcome.result
      ),
      command: String(outcome.approval.args.command || ""),
      kind: outcome.approval.kind,
      status: "pending",
    };
    turn.emit({
      type: "approval",
      botId: turn.bot.id,
      messageId: turn.messageId,
      approval: approvalPart,
    });
    turn.paused = true;
    turn.pendingApprovalId = outcome.approval.id;
    turn.pendingApprovalKind = outcome.approval.kind;
    return Response.json({ result: PAUSED_TEXT });
  }
  turn.emit({
    type: "tool_end",
    botId: turn.bot.id,
    messageId: turn.messageId,
    toolId,
    result: outcome.result.slice(0, 4000),
    status: "done",
  });
  if (outcome.file) {
    turn.emit({
      type: "file",
      botId: turn.bot.id,
      messageId: turn.messageId,
      path: outcome.file.path,
      action: outcome.file.action,
    });
  }
  if (outcome.handoff) turn.pendingHandoff = outcome.handoff;
  return Response.json({
    result: outcome.result.slice(0, 12_000),
    ...(outcome.image ? { image: outcome.image } : {}),
  });
}
