import readline from "node:readline";
import { pathToFileURL } from "node:url";

export async function handleMessage(message, fetchFn) {
  const notification = message.id === undefined || message.id === null;
  let result;
  let error;
  if (message.method === "initialize") {
    result = {
      protocolVersion: message.params?.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "crew", version: "1.0.0" },
    };
  } else if (message.method === "tools/list") {
    result = { tools: JSON.parse(process.env.CREW_TOOLS || "[]") };
  } else if (message.method === "tools/call") {
    try {
      const response = await fetchFn(process.env.CREW_BRIDGE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.CREW_TURN_TOKEN}`,
        },
        body: JSON.stringify({
          name: message.params?.name,
          arguments: message.params?.arguments,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json();
      const content = [{ type: "text", text: String(body.result) }];
      if (body.image) {
        content.push({ type: "image", data: body.image.data, mimeType: body.image.mimeType });
      }
      result = { content };
    } catch (caught) {
      result = {
        content: [{ type: "text", text: caught instanceof Error ? caught.message : String(caught) }],
        isError: true,
      };
    }
  } else {
    error = { code: -32601, message: `Method not found: ${message.method}` };
  }
  if (notification) return null;
  return { jsonrpc: "2.0", id: message.id, ...(error ? { error } : { result }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const reply = await handleMessage(JSON.parse(line), fetch);
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
    } catch {
      // Invalid input is ignored; the transport remains available for later messages.
    }
  });
}
