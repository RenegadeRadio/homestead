import type { CrewEvent, Message } from "@/lib/types";

export function applyEvent(message: Message, event: CrewEvent) {
  if (event.type === "text_delta") {
    const last = message.parts[message.parts.length - 1];
    if (last && last.type === "text") {
      last.text += event.text;
    } else {
      message.parts.push({ type: "text", text: event.text });
    }
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
}

export function persistEmit(message: Message, emit: (e: CrewEvent) => void) {
  return (event: CrewEvent) => {
    applyEvent(message, event);
    emit(event);
  };
}

export function sseResponse(handler: (emit: (e: CrewEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: CrewEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await handler(emit);
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Stream failed.",
        });
        emit({ type: "done" });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // The stream is already closed.
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
