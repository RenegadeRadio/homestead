import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

import { buildSystemPrompt } from "@/lib/agent/prompt";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { DEFAULT_COMPUTER_ROOT } from "@/lib/paths";
import type { Bot, CrewEvent, Provider, Store } from "@/lib/types";

export interface ClaudeCodeTurn {
  store: Store;
  bot: Bot;
  conversationId: string;
  messageId: string;
  emit: (event: CrewEvent) => void;
  sessionId: string;
  paused: boolean;
  toolCalls: number;
  pendingApprovalId?: string;
  pendingApprovalKind?: "shell" | "send" | "takeover";
  pendingHandoff?: { toBotId: string; note: string };
  extendDeadline?: (ms: number) => void;
}

declare global {
  var __crewClaudeCodeTurns: Map<string, ClaudeCodeTurn> | undefined;
}

const turns = (globalThis.__crewClaudeCodeTurns ??= new Map<string, ClaudeCodeTurn>());

export function registerTurn(
  token: string,
  turn: Omit<ClaudeCodeTurn, "paused" | "toolCalls"> & {
    paused?: boolean;
    toolCalls?: number;
  }
) {
  const registered: ClaudeCodeTurn = {
    ...turn,
    paused: turn.paused ?? false,
    toolCalls: turn.toolCalls ?? 0,
  };
  turns.set(token, registered);
  return registered;
}

export function getTurn(token: string) {
  return turns.get(token);
}

export function unregisterTurn(token: string) {
  turns.delete(token);
}

export function buildClaudeCodeInvocation(opts: {
  bot: Bot;
  provider: Provider;
  store: Store;
  prompt: string;
  extra?: string;
  resumeSessionId?: string;
  token: string;
}) {
  const sessionId = opts.resumeSessionId || crypto.randomUUID();
  const port = Number(process.env.PORT) || 43177;
  const tools = TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
  const mcpConfig = {
    mcpServers: {
      crew: {
        command: "node",
        args: [path.join(process.cwd(), "scripts", "crew-mcp.mjs")],
        env: {
          CREW_BRIDGE_URL: `http://127.0.0.1:${port}/api/agent-tools`,
          CREW_TURN_TOKEN: opts.token,
          CREW_TOOLS: JSON.stringify(tools),
        },
      },
    },
  };
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    opts.bot.model || opts.provider.defaultModel,
  ];
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  } else {
    args.push(
      "--session-id",
      sessionId,
      "--system-prompt",
      buildSystemPrompt(opts.bot, opts.store, opts.extra)
    );
  }
  args.push("--tools", "", "--strict-mcp-config", "--mcp-config", JSON.stringify(mcpConfig));
  for (const tool of TOOL_DEFINITIONS) {
    args.push("--allowedTools", `mcp__crew__${tool.name}`);
  }
  args.push("--", opts.prompt);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return { command: "claude", args, env, sessionId };
}

export async function runClaudeCodeTurn(opts: {
  store: Store;
  bot: Bot;
  provider: Provider;
  conversationId: string;
  messageId: string;
  prompt: string;
  extra?: string;
  resumeSessionId?: string;
  emit: (event: CrewEvent) => void;
  signal: AbortSignal;
  onHandoff?: (toBotId: string, note: string) => Promise<void>;
  spawnFn?: typeof spawn;
}) {
  const token = crypto.randomBytes(16).toString("hex");
  const invocation = buildClaudeCodeInvocation({ ...opts, token });
  const turn = registerTurn(token, {
    store: opts.store,
    bot: opts.bot,
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    emit: opts.emit,
    sessionId: invocation.sessionId,
  });
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  let deadlineAt = startedAt + 10 * 60 * 1000;
  let timedOut = false;
  const abort = () => child?.kill("SIGKILL");
  const resetDeadlineTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, Math.max(0, deadlineAt - Date.now()));
  };
  turn.extendDeadline = (ms: number) => {
    deadlineAt += Math.max(0, ms);
    resetDeadlineTimer();
  };
  try {
    child = (opts.spawnFn ?? spawn)(invocation.command, invocation.args, {
      cwd: opts.store.settings.computerRoot || DEFAULT_COMPUTER_ROOT,
      env: invocation.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    opts.signal.addEventListener("abort", abort, { once: true });
    if (opts.signal.aborted) abort();
    resetDeadlineTimer();
    const exitCode = await new Promise<number>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", (code) => resolve(code ?? 1));
    });
    if (timedOut) {
      const minutes = Math.round((deadlineAt - startedAt) / 60_000);
      throw new Error(`Turn stopped after ${minutes} minutes (time limit).`);
    }
    let parsed: { result?: string; session_id?: string; is_error?: boolean } | undefined;
    let parseError: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      parseError = error;
    }
    if (exitCode !== 0 || parseError || parsed?.is_error) {
      const cleanStderr = stderr
        .split("\n")
        .filter((line) => !line.startsWith("Warning: no stdin data received"))
        .join("\n")
        .trim();
      const detail = (cleanStderr || parsed?.result || stdout || "Claude Code failed.").slice(0, 500);
      throw new Error(`Claude Code turn failed: ${detail}`);
    }
    if (parsed?.result) {
      opts.emit({
        type: "text_delta",
        botId: opts.bot.id,
        messageId: opts.messageId,
        text: parsed.result,
      });
    }
    if (turn.paused) {
      opts.emit({
        type: "paused",
        reason: turn.pendingApprovalKind === "takeover" ? "takeover" : "approval",
        approvalId: turn.pendingApprovalId!,
      });
    } else if (turn.pendingHandoff && opts.onHandoff) {
      await opts.onHandoff(turn.pendingHandoff.toBotId, turn.pendingHandoff.note);
    }
    return { sessionId: parsed?.session_id || invocation.sessionId };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal.removeEventListener("abort", abort);
    const message = opts.store.messages.find((item) => item.id === opts.messageId);
    for (const part of message?.parts ?? []) {
      if (part.type !== "tool" || part.status !== "running") continue;
      const result = "Interrupted: the turn ended before this tool finished.";
      part.status = "error";
      part.result = result;
      opts.emit({
        type: "tool_end",
        botId: opts.bot.id,
        messageId: opts.messageId,
        toolId: part.id,
        result,
        status: "error",
      });
    }
    unregisterTurn(token);
  }
}
