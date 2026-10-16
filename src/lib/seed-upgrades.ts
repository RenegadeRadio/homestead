import { createSeedStore } from "@/lib/seed";

export const SKILL_BODY_UPGRADES: {
  slug: string;
  oldBody: string;
  newBody: () => string;
}[] = [
  {
    slug: "signed-in-site",
    oldBody: `Work in the shared browser the way Grok Bot does.

1. browser_navigate to the site (LinkedIn, etc.).
2. If login, 2FA, CAPTCHA, or a password field appears, request_takeover. Never ask for secrets in chat.
3. After the user continues, snapshot and proceed.
4. Draft in the compose box with browser_type.
5. Do not click Send, Post, Invite, or Connect until the user approves.
6. If the site blocks automation, stop and say so \u2014 do not try to hide that you are a Bot.`,
    newBody: () =>
      createSeedStore().skills.find((skill) => skill.slug === "signed-in-site")!
        .body,
  },
];

export const README_UPGRADES: { oldText: string; newText: string }[] = [
  {
    oldText: `# Shared computer

Every Bot on this Crew account works here. Files, scripts, and drafts live on disk so handoffs do not depend on chat history.

Folders:
- briefs/ \u2014 dated research and morning notes
- drafts/ \u2014 writing held for your approval
- research/ \u2014 source-backed memos
- inbox/ \u2014 files you attach in chat
- scripts/ \u2014 code Bots run from the terminal

Treat anything placed here as visible to every Bot.
`,
    newText: `# Shared computer

Every Bot in Homestead works here. Files, scripts, and drafts live on disk so handoffs do not depend on chat history.

Folders:
- briefs/: dated research and morning notes
- drafts/: writing held for your approval
- research/: source-backed memos
- inbox/: files you attach in chat
- scripts/: code Bots run from the terminal

Treat anything placed here as visible to every Bot.
`,
  },
];
