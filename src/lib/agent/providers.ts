import type { LlmMessage, LlmToolCall } from "@/lib/types";

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return { value: raw };
    }
  }
  return {};
}

export function parseToolFences(text: string): { clean: string; calls: LlmToolCall[] } {
  const calls: LlmToolCall[] = [];
  let clean = text;
  const fence = /```tool\s*([\s\S]*?)```/gi;
  clean = clean.replace(fence, (_, body, offset) => {
    try {
      const json = JSON.parse(String(body).trim());
      if (json?.name) {
        calls.push({
          id: `call_text_${offset}`,
          name: String(json.name),
          arguments: parseArgs(json.arguments ?? json.args ?? {}),
        });
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const xml = /<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/gi;
  clean = clean.replace(xml, (_, name, body, offset) => {
    calls.push({
      id: `call_xml_${offset}`,
      name: String(name),
      arguments: parseArgs(body.trim()),
    });
    return "";
  });
  return { clean: clean.trim(), calls };
}

export function toOpenAIMessages(messages: LlmMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        content: m.content,
        tool_call_id: m.tool_call_id || "tool",
      };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || null,
        tool_calls: m.tool_calls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export async function openaiComplete(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  tools: unknown[];
  signal?: AbortSignal;
}) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const timeoutSignal = AbortSignal.timeout(120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: toOpenAIMessages(opts.messages),
      tools: opts.tools,
      tool_choice: "auto",
      temperature: 0.4,
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Model provider ${res.status}: ${err.slice(0, 800)}`);
  }
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: {
          id: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const tool_calls: LlmToolCall[] = (msg?.tool_calls || [])
    .filter((c) => c.function?.name)
    .map((c) => ({
      id: c.id,
      name: c.function!.name!,
      arguments: parseArgs(c.function!.arguments || "{}"),
    }));
  const content = msg?.content || "";
  const fenced = parseToolFences(content);
  return {
    content: fenced.clean,
    tool_calls: tool_calls.length ? tool_calls : fenced.calls,
  };
}

export async function listOpenAIModels(baseUrl: string, apiKey: string) {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/models`, {
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`Could not list models (${res.status}).`);
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data || []).map((m) => m.id).slice(0, 80);
}

export async function anthropicComplete(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  tools: unknown[];
  signal?: AbortSignal;
}) {
  const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const converted: unknown[] = [];
  for (const m of opts.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: m.content,
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      converted.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.tool_calls.map((c) => ({
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: c.arguments,
          })),
        ],
      });
      continue;
    }
    converted.push({ role: m.role, content: m.content });
  }

  const origin = opts.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const timeoutSignal = AbortSignal.timeout(120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(`${origin}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      system,
      tools: opts.tools,
      messages: converted,
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 800)}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  };
  const blocks = data.content || [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
  const tool_calls: LlmToolCall[] = blocks
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => ({
      id: b.id || `tool_${b.name}`,
      name: b.name!,
      arguments: parseArgs(b.input),
    }));
  const fenced = parseToolFences(text);
  return {
    content: fenced.clean,
    tool_calls: tool_calls.length ? tool_calls : fenced.calls,
  };
}
