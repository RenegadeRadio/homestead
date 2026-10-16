import { nid, nowIso } from "@/lib/ids";
import { DEFAULT_COMPUTER_ROOT } from "@/lib/paths";
import type { Store } from "@/lib/types";

export function createSeedStore(): Store {
  const demo = {
    id: "prov_demo",
    name: "Built-in demo",
    kind: "demo" as const,
    baseUrl: "",
    apiKey: "",
    defaultModel: "crew-demo",
  };

  const opencompat = {
    id: "prov_openai",
    name: "OpenAI-compatible",
    kind: "openai-compatible" as const,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-4.1",
  };

  const ollama = {
    id: "prov_ollama",
    name: "Ollama",
    kind: "openai-compatible" as const,
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "ollama",
    defaultModel: "llama3.1",
  };

  const anthropic = {
    id: "prov_anthropic",
    name: "Anthropic",
    kind: "anthropic" as const,
    baseUrl: "https://api.anthropic.com",
    apiKey: "",
    defaultModel: "claude-sonnet-4-5",
  };

  const atlas = {
    id: "bot_atlas",
    name: "Atlas",
    job: "Chief of staff",
    instructions:
      "Own the outcome. Break work into owners, keep the user out of the middle, and only escalate for judgment or approval. Prefer handing a specialist a crisp brief over doing their job yourself.",
    memory: "",
    emoji: "🧭",
    color: "#d6a24a",
    providerId: demo.id,
    model: demo.defaultModel,
    createdAt: nowIso(),
  };

  const scout = {
    id: "bot_scout",
    name: "Scout",
    job: "Researcher",
    instructions:
      "Search, fetch, and verify. Link every claim. Prefer current sources over memory. Write briefs into the computer instead of dumping a wall of chat.",
    memory: "",
    emoji: "🔎",
    color: "#6ea8ff",
    providerId: demo.id,
    model: demo.defaultModel,
    createdAt: nowIso(),
  };

  const forge = {
    id: "bot_forge",
    name: "Forge",
    job: "Engineer",
    instructions:
      "Work in the shared computer: files, scripts, and the terminal. Implement rather than describe. Stop for approval before destructive or outbound actions.",
    memory: "",
    emoji: "🛠️",
    color: "#7dce9a",
    providerId: demo.id,
    model: demo.defaultModel,
    createdAt: nowIso(),
  };

  const quill = {
    id: "bot_quill",
    name: "Quill",
    job: "Writer",
    instructions:
      "Draft in the user's voice: direct, specific, no corporate fog. Turn research into something shippable and leave it for approval rather than sending it.",
    memory: "",
    emoji: "✒️",
    color: "#e08b8b",
    providerId: demo.id,
    model: demo.defaultModel,
    createdAt: nowIso(),
  };

  const desk = {
    id: "convo_desk",
    kind: "group" as const,
    title: "Desk",
    botIds: [atlas.id, scout.id, forge.id, quill.id],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const dm = (botId: string, title: string) => ({
    id: `convo_${botId.replace("bot_", "")}`,
    kind: "dm" as const,
    title,
    botIds: [botId],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const briefing = {
    id: "skill_briefing",
    name: "Daily briefing",
    slug: "daily-briefing",
    body: `Produce a morning briefing.

Steps:
1. Search the web for the topics the user cares about (or ask once if unknown).
2. Fetch the top sources and quote them with links.
3. Write computer/briefs/YYYY-MM-DD.md with: headline, three bullets, risks, and what needs a human today.
4. Do not email, post, or notify anyone. Leave the file for review.

If sources are unavailable, say so. Never pad with stale memory.`,
    createdAt: nowIso(),
  };

  const research = {
    id: "skill_research",
    name: "Source-backed research",
    slug: "source-backed-research",
    body: `Research a question end to end.

- Search first, then fetch the pages you will cite.
- Put the brief in computer/research/<slug>.md
- Every factual claim needs a URL.
- End with: what you still don't know, and what would change the answer.
- Do not publish.`,
    createdAt: nowIso(),
  };

  const draft = {
    id: "skill_draft",
    name: "Draft and hold",
    slug: "draft-and-hold",
    body: `Turn context into a draft the user can send later.

- Save to computer/drafts/<slug>.md
- Match the user's voice if memory has it; otherwise write plainly.
- Do not send, post, or publish. The draft is the deliverable.
- Call out anything that still needs a fact check.`,
    createdAt: nowIso(),
  };

  const outreach = {
    id: "skill_signed_in",
    name: "Signed-in site",
    slug: "signed-in-site",
    body: `Work in the shared browser the way a careful person would.

1. browser_navigate to the site (LinkedIn, etc.).
2. If login, 2FA, CAPTCHA, or a password field appears, request_takeover. Never ask for secrets in chat.
3. After the user continues, snapshot and proceed.
4. Draft in the compose box with browser_type.
5. Do not click Send, Post, Invite, or Connect until the user approves.
6. If the site blocks automation, stop and say so. Do not try to hide that you are a Bot.`,
    createdAt: nowIso(),
  };

  return {
    providers: [demo, opencompat, ollama, anthropic],
    bots: [atlas, scout, forge, quill],
    conversations: [
      desk,
      dm(atlas.id, "Atlas"),
      dm(scout.id, "Scout"),
      dm(forge.id, "Forge"),
      dm(quill.id, "Quill"),
    ],
    messages: [
      {
        id: nid("msg"),
        conversationId: desk.id,
        role: "system",
        parts: [
          {
            type: "text",
            text: "Desk is a group. Write normally and the team will pick an owner, or @mention a Bot when one teammate should take it. Type / to run a skill.",
          },
        ],
        createdAt: nowIso(),
        reactions: [],
      },
    ],
    skills: [briefing, research, draft, outreach],
    routines: [],
    plugins: [],
    settings: {
      shellPolicy: "ask",
      autoReview: [
        {
          id: nid("rule"),
          kind: "always-allow",
          pattern: "^(ls|pwd)\\b",
        },
        {
          id: nid("rule"),
          kind: "require-approval",
          pattern: "(rm |sudo |curl .+ \\| |shutdown|reboot|mkfs)",
        },
      ],
      computerRoot: DEFAULT_COMPUTER_ROOT,
    },
    computerLogs: [],
    browseSnapshots: [],
    pendingApprovals: [],
    terminalSessions: [],
  };
}
