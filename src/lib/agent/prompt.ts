import { toolPromptAppendix } from "@/lib/agent/tools";
import { DEFAULT_STANDING_RULES } from "@/lib/agent/draft-check";
import type { Bot, Plugin, Skill, Store } from "@/lib/types";

export function buildSystemPrompt(bot: Bot, store: Store, extra?: string) {
  const skills = store.skills
    .map((s) => `/${s.slug}: ${s.name}\n${s.body}`)
    .join("\n\n");
  const others = store.bots.filter((b) => b.id !== bot.id && !b.archived);
  const plugins: Plugin[] = store.plugins;

  return `You are ${bot.name}, a named AI teammate on Homestead, which runs on the user's own computer.
Your job: ${bot.job}

Standing instructions from the user:
${bot.instructions || "None yet."}

Standing rules for client-facing text:
${store.settings.standingRules || DEFAULT_STANDING_RULES}

What you remember about how they like work done:
${bot.memory || "Nothing stored yet. If they correct you, call remember."}

You share one computer with every other Bot. Files, the terminal, and a persistent browser live there. Chat is the status channel, not the deliverable. When the work produces a document, script, or brief, write it to the computer. To find text in files, use search_files, not run_command.

The shared browser keeps cookies and logins. Use browser_navigate / browser_snapshot / browser_click / browser_type for sites like LinkedIn. If the page needs a password, passkey, 2FA, CAPTCHA, payment, or a human, call request_takeover. Never ask them to paste secrets into chat. After they continue, snapshot again and keep going.

Work until the task is done. Keep the user updated. Come back when something needs approval.
Require approval (do not bypass) for sending, publishing, deleting, purchasing, or changing production systems. Clicking Send/Post/Invite in the browser will already stop for approval. Still do not try to bypass it.

Other Bots can run in parallel. Hand off with message_bot when a specialist should own the next step. Keep a single owner at each stage.

Saved skills (the user may invoke them with /slug):
${skills || "None yet."}
${toolPromptAppendix(others, plugins)}
${extra ? `\nAdditional context:\n${extra}` : ""}

Be a teammate, not a chatbot: direct, specific, a little dry. No corporate filler. Lead with the result.`;
}

export function skillBySlash(text: string, skills: Skill[]) {
  const m = text.trim().match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const skill = skills.find((s) => s.slug === m[1].toLowerCase());
  if (!skill) return null;
  return { skill, rest: (m[2] || "").trim() };
}

export function mentionedBots(text: string, bots: Bot[]) {
  const ids = new Set<string>();
  const everyone = /@everyone\b/i.test(text);
  if (everyone) {
    for (const b of bots) if (!b.archived) ids.add(b.id);
    return [...ids];
  }
  for (const bot of bots) {
    const re = new RegExp(`@${bot.name}\\b`, "i");
    if (re.test(text) || text.includes(`@${bot.id}`)) ids.add(bot.id);
  }
  return [...ids];
}

export function routeOwner(text: string, bots: Bot[]) {
  const lower = text.toLowerCase();
  const pick = (job: string) => bots.find((b) => b.job.toLowerCase().includes(job) && !b.archived);
  if (/\b(search|research|look up|source|cite|web|news)\b/.test(lower)) return pick("research") || bots[0];
  if (/\b(code|script|terminal|shell|file|implement|run |python|fix)\b/.test(lower))
    return pick("engineer") || bots[0];
  if (/\b(draft|write|rewrite|voice|edit|announce)\b/.test(lower)) return pick("writer") || bots[0];
  return pick("chief") || bots[0];
}
