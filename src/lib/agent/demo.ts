import { nid, nowIso } from "@/lib/ids";
import { executeTool } from "@/lib/agent/execute";
import type { Bot, CrewEvent, Store } from "@/lib/types";

function stamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function streamText(text: string, emit: (e: CrewEvent) => void, botId: string, messageId: string) {
  const parts = text.split(/(\s+)/);
  let buf = "";
  for (const p of parts) {
    buf += p;
    if (buf.length > 24 || p.includes("\n")) {
      emit({ type: "text_delta", botId, messageId, text: buf });
      buf = "";
    }
  }
  if (buf) emit({ type: "text_delta", botId, messageId, text: buf });
}

function looksLikeUrl(text: string) {
  return text.match(/https?:\/\/[^\s)]+/g) || [];
}

export async function runDemoBot(opts: {
  store: Store;
  bot: Bot;
  userText: string;
  conversationId: string;
  messageId: string;
  emit: (e: CrewEvent) => void;
  extra?: string;
}): Promise<{ handoffs: { toBotId: string; note: string }[] }> {
  const { store, bot, userText, conversationId, messageId, emit } = opts;
  const lower = userText.toLowerCase();
  const job = bot.job.toLowerCase();
  const handoffs: { toBotId: string; note: string }[] = [];

  const call = async (name: string, args: Record<string, unknown>) => {
    const toolId = nid("tool");
    emit({ type: "tool_start", botId: bot.id, messageId, toolId, name, args });
    const outcome = await executeTool(name, args, { store, bot, conversationId, messageId });
    if (outcome.approval) {
      outcome.approval.checkpoint = [];
      store.pendingApprovals.push(outcome.approval);
      const part = {
        type: "approval" as const,
        id: outcome.approval.id,
        title: outcome.approval.title || "Needs you",
        detail: String(
          outcome.approval.args.command ||
            outcome.approval.args.reason ||
            outcome.result
        ),
        command: String(outcome.approval.args.command || ""),
        kind: outcome.approval.kind,
        status: "pending" as const,
      };
      emit({ type: "approval", botId: bot.id, messageId, approval: part });
      emit({
        type: "paused",
        reason: outcome.approval.kind === "takeover" ? "takeover" : "approval",
        approvalId: outcome.approval.id,
      });
      return outcome;
    }
    emit({
      type: "tool_end",
      botId: bot.id,
      messageId,
      toolId,
      result: outcome.result.slice(0, 4000),
      status: "done",
    });
    if (outcome.file) {
      emit({
        type: "file",
        botId: bot.id,
        messageId,
        path: outcome.file.path,
        action: outcome.file.action,
      });
    }
    if (outcome.handoff) handoffs.push(outcome.handoff);
    return outcome;
  };

  const reply = (text: string) => streamText(text, emit, bot.id, messageId);

  const urls = looksLikeUrl(userText);
  const wantsSearch = /\b(search|research|look up|find|news|what's happening|latest|source)\b/.test(lower);
  const wantsBrowse = urls.length > 0 || /\b(open|browse|fetch|read this)\b/.test(lower);
  const wantsWrite =
    /\b(write|draft|save|brief|memo|note|create a file|put it in)\b/.test(lower) ||
    job.includes("writer") ||
    job.includes("research");
  const wantsCommand = /\b(run |execute|script|python|ls\b|list files|terminal)\b/.test(lower);
  const wantsHandoff = /\b(hand off|ask |pass this|@)\b/.test(lower);
  const wantsRemember = /\b(remember|from now on|prefer)\b/.test(lower);
  const wantsSkill = /\b(save (this )?as a skill|turn this into a skill)\b/.test(lower);
  const wantsBrowser =
    /\b(linkedin|inmail|shared browser|browser session|take over)\b/.test(lower) ||
    /linkedin\.com/.test(lower) ||
    /\b(log in|sign in)\b/.test(lower);

  if (wantsRemember) {
    await call("remember", { note: userText });
    reply("Logged. I'll treat that as standing preference for this Bot.");
    return { handoffs };
  }

  if (wantsSkill) {
    await call("save_skill", {
      name: "Learned workflow",
      body: `Captured from conversation on ${stamp()}.\n\nUser asked:\n${userText}\n\nFill in decision rules and approval boundaries before turning this into a routine.`,
    });
    reply("Draft skill saved. Tighten the decision rules before you put it on a schedule.");
    return { handoffs };
  }

  if (wantsBrowser) {
    const url = urls[0] || (/linkedin/i.test(userText) ? "https://www.linkedin.com/" : "https://www.linkedin.com/");
    const nav = await call("browser_navigate", { url });
    if (nav.approval) {
      reply(
        "Shared browser is open. Computer → Browser is the screen. Sign in there. Password, 2FA, and CAPTCHA stay with you. Don't paste secrets here. Continue when the feed is up and I'll draft; I won't click Send without approval."
      );
      return { handoffs };
    }
    reply(
      "We're in the shared browser. Point me at a profile or a thread. I'll draft in the compose box and stop before Send."
    );
    return { handoffs };
  }

  if (job.includes("chief") && !/@/.test(userText) && /desk|team|plan|coordinate|everyone/i.test(userText)) {
    const scout = store.bots.find((b) => /research/i.test(b.job));
    const quill = store.bots.find((b) => /writer/i.test(b.job));
    if (scout) {
      await call("message_bot", {
        bot: scout.name,
        note: `From Atlas. User asked: ${userText}\nGather sources, link claims, write a brief into computer/research/.`,
      });
    }
    if (quill) {
      await call("message_bot", {
        bot: quill.name,
        note: `From Atlas. After Scout's brief (or in parallel if sources are already in computer/research/), draft a hold-for-approval note in computer/drafts/. Do not publish.`,
      });
    }
    reply(
      "I'll keep this off your plate. Scout owns sources, Quill owns the draft, and nothing leaves the computer without you."
    );
    return { handoffs };
  }

  if (wantsHandoff) {
    const names = store.bots.filter((b) => b.id !== bot.id && new RegExp(b.name, "i").test(userText));
    for (const other of names) {
      await call("message_bot", { bot: other.name, note: userText });
    }
    if (names.length) {
      reply(`Passed to ${names.map((n) => n.name).join(" and ")}. I'll stay out of their way unless they bounce it back.`);
      return { handoffs };
    }
  }

  let researchBlob = "";
  if (wantsSearch || (job.includes("research") && userText.length > 12)) {
    const query = userText.replace(/^\/[a-z0-9-]+\s*/i, "").slice(0, 180);
    const search = await call("web_search", { query });
    researchBlob += search.result + "\n";
    const firstUrl = search.result.match(/https?:\/\/\S+/)?.[0];
    if (firstUrl) {
      const page = await call("browse_url", { url: firstUrl });
      researchBlob += "\n" + page.result.slice(0, 2500);
    }
  }

  if (wantsBrowse) {
    for (const url of urls.slice(0, 3)) {
      const page = await call("browse_url", { url });
      researchBlob += "\n" + page.result.slice(0, 2500);
    }
  }

  if (/\b(list files|ls\b|what.{0,24}on the (shared )?computer)\b/.test(lower) || (/\blist\b/.test(lower) && /\bfiles?\b/.test(lower))) {
    const listed = await call("list_files", { path: "." });
    reply(`On the shared computer:\n\n\`\`\`\n${listed.result}\n\`\`\`\n\nTell me what to build or run and I'll do it here.`);
    return { handoffs };
  }

  if (wantsCommand || (job.includes("engineer") && /\b(hello|script)\b/.test(lower))) {
    const script = `print("Forge checking in from the shared computer at ${nowIso()}")\n`;
    await call("write_file", { path: "scripts/hello.py", content: script });
    const ran = await call("run_command", { command: "python3 scripts/hello.py" });
    if (ran.approval) {
      reply("Script is on the computer. The shell is waiting on your approval to run it.");
      return { handoffs };
    }
  }

  if (wantsWrite || researchBlob) {
    const slug = userText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "note";
    const folder = job.includes("writer") ? "drafts" : job.includes("research") ? "research" : "briefs";
    const path = `${folder}/${stamp()}-${slug}.md`;
    const body = `# ${userText.slice(0, 80)}

Written by ${bot.name} (${bot.job}) on ${stamp()}.
This is a computer file, not a chat draft. Do not send it without the user.

## Ask
${userText}

${opts.extra ? `## Skill / extra\n${opts.extra}\n` : ""}
## Notes
${researchBlob ? researchBlob.slice(0, 3500) : `${bot.name} handled this on the shared computer.`}
`;
    await call("write_file", { path, content: body });
    reply(
      `Done. Left it at \`${path}\` on the shared computer so anyone on the team can pick it up.\n\nI didn't send, post, or publish anything.`
    );
    return { handoffs };
  }

  if (job.includes("engineer")) {
    await call("list_files", { path: "." });
    reply("Shared computer is up. Tell me what to build or run and I'll do it here instead of pasting a plan.");
    return { handoffs };
  }

  reply(
    `${bot.name} here, ${bot.job.toLowerCase()}. Give me a finish line and what I may change. I'll work on the shared computer and only ping you for approval.`
  );
  return { handoffs };
}
