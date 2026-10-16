import type { MutateOp } from "@/lib/ops";
import type { CrewEvent, FileNode, Store } from "@/lib/types";

export async function bootstrap(): Promise<{ store: Store; tree: FileNode[] }> {
  const res = await fetch("/api/bootstrap", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load Homestead.");
  return res.json();
}

export async function mutate(op: MutateOp) {
  const res = await fetch("/api/mutate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Update failed.");
  return data;
}

export async function sendOutbox() {
  const res = await fetch("/api/outbox", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Send failed.");
  return data;
}

export async function readSse(res: Response, onEvent: (event: CrewEvent) => void) {
  if (!res.body) throw new Error("No stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.replace(/^data:\s?/, "");
      try {
        onEvent(JSON.parse(json) as CrewEvent);
      } catch {
        /* ignore keepalives */
      }
    }
  }
}

export async function sendChat(
  payload: {
    conversationId: string;
    text: string;
    mentions?: string[];
    skillId?: string;
    attachments?: { name: string; path: string }[];
  },
  onEvent: (event: CrewEvent) => void
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Chat failed.");
  }
  await readSse(res, onEvent);
}

export async function decideApproval(
  approvalId: string,
  decision: "approved" | "denied",
  onEvent: (event: CrewEvent) => void
) {
  const res = await fetch("/api/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalId, decision }),
  });
  await readSse(res, onEvent);
}

export async function runRoutine(id: string, onEvent: (event: CrewEvent) => void) {
  const res = await fetch("/api/routines/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  await readSse(res, onEvent);
}

export async function uploadFile(file: File) {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/computer/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data as { path: string; name: string };
}

export async function loadFile(path: string) {
  const res = await fetch(`/api/computer/file?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Read failed.");
  return data as { path: string; content: string };
}

export async function loadComputer() {
  const res = await fetch("/api/computer", { cache: "no-store" });
  return res.json();
}

export async function loadModels(providerId: string) {
  const res = await fetch(`/api/models?providerId=${encodeURIComponent(providerId)}`);
  return res.json() as Promise<{ models: string[]; error?: string }>;
}
