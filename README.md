# Homestead

Homestead runs AI teammates on your own computer: named Bots with a shared computer, group chat, skills, routines, and approvals. Drive every Bot with any model — OpenAI, Anthropic, xAI, Ollama, OpenRouter, Groq, vLLM, llama.cpp, or anything else that speaks the OpenAI chat API.

The built-in **demo model** works with no API key so you can use the product immediately. Swap a Bot to a real provider in Settings when you want full reasoning.

## What it does

Homestead covers what makes a teammate, not a chatbot:

- **Named Bots** with a job, standing instructions, and memory that compounds
- **A shared computer** — files, terminal, and a **persistent browser** every Bot can use
- **Chat** like a teammate, including `@mentions`, `/skills`, attachments, reactions, and stop
- **Group chats** where Bots pick an owner or take an explicit handoff
- **Skills** (how to do a job) and **routines** (when to run it)
- **Approvals** for shell commands and for Send/Post in the browser
- **Takeover** for passwords, 2FA, and CAPTCHA — secrets stay in the browser, not chat
- **HTTP plugins** as connectors
- **Any model** per Bot

The browser keeps a Chrome profile in `data/browser-profile/`. You take over, sign into LinkedIn (or anything else), then Continue. Bots keep that session. They still stop before Send.

It does **not** ship iOS/Android apps or a remote cloud VM. The computer is this machine: a folder, a shell, and a headed-looking Chrome the web UI mirrors.

## LinkedIn and other logged-in sites

1. Assign a computer-use model (Claude Fable 5 / Opus 4.8) on the Bot that will drive the browser.
2. Ask it to open LinkedIn, or click **Computer → Browser → Start**.
3. When it stops for takeover, sign in on that screen. Don't paste the password into chat.
4. Click **I'm signed in — continue**. It can draft. Sending still needs your approval.

LinkedIn's terms restrict automated messaging. Keep Send behind approval and don't spray InMail unattended. Read the disclaimer below before you point a Bot at LinkedIn.

## Disclaimer

**Use at your own risk.** Homestead is provided as is, with no warranty (see [LICENSE](LICENSE), MIT).

- **LinkedIn and X do not allow automated use of their sites.** Their user agreements prohibit bots and automated
  access. Using Homestead's browser on them can get your account restricted or banned. The author's own LinkedIn account
  was temporarily restricted after about 280 page loads in an hour, with no messages sent at all.
- **Homestead is built to keep a person in charge**, not to send unattended. Every LinkedIn send waits for your approval in
  the Outbox. It also has daily and weekly invite caps, a page-load cap, randomised gaps between actions, a sending
  window, and a hold that stops all LinkedIn work when LinkedIn shows a login or checkpoint page. Those defaults
  are there for a reason; loosening them is your decision and your risk.
- **The people you contact have rights.** Homestead stores names and profile addresses of the people you work with in
  `data/store.json` on your machine. Privacy laws such as the GDPR and South Africa's POPIA limit unsolicited direct
  marketing and how you keep personal information. Complying with them, and with each site's terms, is your
  responsibility.
- **Not affiliated with** LinkedIn, X, xAI, OpenAI, Anthropic or any other company named here. Product names belong to
  their owners.

## Known issues

These are open and not being worked on. Pull requests are welcome.

- Acceptances are not counted per invite note, so you cannot yet see which note works best.
- An accepted invite's follow-up can fail as "Already messaged", because the invite note counts as a message; one
  failure stops the rest of the Outbox run.
- A direct invite can click a copy of the invite link hidden under LinkedIn's sticky header, time out after 30 s and
  fall back to a slower Bot turn.
- The acceptances routine can report follow-ups as waiting for approval after they were settled.
- A draft you sent by hand cannot be marked as sent; approving it would send it twice.
- A message send can leave the previous conversation open, so the next send asks for approval again.
- Nothing confirms who an invite actually went to; a wrong recipient is only found by checking by hand.

## Run it

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43177](http://127.0.0.1:43177).

Data lives in `data/` (gitignored): `store.json` for Bots and chat, `computer/` for the shared workspace.

## Point a Bot at a real model

Settings → Models.

| Provider | Base URL | Notes |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | API key required |
| xAI / Grok | `https://api.x.ai/v1` | Same OpenAI-compatible shape |
| OpenRouter | `https://openrouter.ai/api/v1` | One key, many models including Anthropic |
| Ollama | `http://127.0.0.1:11434/v1` | Key can be `ollama` |
| Anthropic | `https://api.anthropic.com` | Native Messages API |
| Groq / Together / Fireworks / vLLM | their `/v1` endpoint | OpenAI-compatible |

Then assign that provider and a model id on each Bot.

Tool calling works best on models that support OpenAI `tools`. Homestead also parses fenced ` ```tool ` JSON so smaller local models can still act.

## Safety

Default shell policy is **ask every time**. Require-approval rules always win. Do not paste passwords into chat — if a site needs a human, take over that step yourself.

Treat the shared computer as shared: every Bot can see every file you put there.

## Production build

```bash
npm run build
npm start
```
