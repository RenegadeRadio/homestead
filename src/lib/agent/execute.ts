import {
  browserClick,
  browserComposeText,
  browserLook,
  browserNavigate,
  browserPageText,
  browserPress,
  browserScroll,
  browserSnapshot,
  browserType,
  looksLikeSend,
  setBrowserMode,
} from "@/lib/browser";
import { nid, nowIso, slugify } from "@/lib/ids";
import {
  formatCompanyCandidate,
  normalizeCompanyDomain,
  recordCompanyCandidate,
} from "@/lib/company-candidates";
import {
  checkLinkedInPacing,
  isLinkedInSendAction,
  isLinkedInUrl,
  linkedInSendGapSeconds,
  noteLinkedInSendPaced,
  quotedLabelText,
} from "@/lib/agent/linkedin-pacing";
import {
  automaticLinkedInHoldReason,
  checkLinkedInHold,
  checkLinkedInInviteCap,
  checkLinkedInInvitePause,
  checkLinkedInWeeklyInviteCap,
  checkLinkedInPageBudget,
  checkLinkedInSendWindow,
  DEFAULT_LINKEDIN_DAILY_INVITE_CAP,
  DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP,
  DEFAULT_LINKEDIN_DAILY_PAGE_LOADS,
  DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY,
  DEFAULT_LINKEDIN_SEND_WINDOW_END,
  DEFAULT_LINKEDIN_SEND_WINDOW_START,
  findLinkedInInviteRefusal,
  formatSastTime,
  linkedInBudgetIO,
  linkedInPathChanged,
  nextLinkedInWindowStart,
  pauseLinkedInInvites,
  pruneLinkedInPageLoads,
  recordLinkedInPageLoad,
  scheduleNextLinkedInAction,
  waitForLinkedInActionGap,
} from "@/lib/agent/linkedin-budget";
import {
  forgetTypedText,
  isInviteConfirmation,
  linkedInProfileSlug,
  reconcileInviteProspects,
  recordLinkedInSend,
  rememberTypedText,
} from "@/lib/agent/linkedin-send-log";
import {
  DEFAULT_BANNED_PHRASES,
  draftCheckRefusal,
  findDraftProblems,
} from "@/lib/agent/draft-check";
import {
  listTree,
  readComputerFile,
  resolveInComputer,
  runCommand,
  searchComputerFiles,
  writeComputerFile,
} from "@/lib/computer";
import { fetchUrl, webSearch } from "@/lib/web";
import type {
  AutoReviewRule,
  Bot,
  CrmProspectEntry,
  HeadcountBand,
  PendingApproval,
  ShellPolicy,
  Store,
} from "@/lib/types";
import { confirmOutboxItemSent, createOutboxItem } from "@/lib/outbox";
import { inviteNoteReport } from "@/lib/invite-notes";
import { measureOutboxAftermath } from "@/lib/outbox-aftermath";
import { isOutboxPreapproved, isOutboxSendText } from "@/lib/outbox-preapproval";
import { syncProspectAcceptance } from "@/lib/crm/notion-sync";
import { createXReply } from "@/lib/x-replies";
import {
  automaticXHoldReason,
  checkXHold,
  checkXPageBudget,
  DEFAULT_X_DAILY_PAGE_LOADS,
  isXUrl,
  pruneXPageLoads,
  recordXPageLoad,
  scheduleNextXAction,
  waitForXActionGap,
  xBrowserRefusal,
} from "@/lib/agent/x-budget";

export { DEFAULT_TOOL_BUDGET_PER_TURN } from "@/lib/agent/tool-budget";

export function needsApproval(
  command: string,
  policy: ShellPolicy,
  rules: AutoReviewRule[]
) {
  const isPlainCommand =
    !/[;&|`$><\n\r]/.test(command) &&
    !command
      .split(/\s+/)
      .filter(Boolean)
      .some((word) => word.startsWith("/") || word.startsWith("~") || word.includes(".."));
  if (policy === "never") return { required: true, reason: "Local shell is set to never allowed." };
  const require = rules.filter((r) => r.kind === "require-approval");
  const allow = rules.filter((r) => r.kind === "always-allow");
  for (const rule of require) {
    try {
      if (new RegExp(rule.pattern, "i").test(command)) {
        return { required: true, reason: `Require-approval rule: /${rule.pattern}/` };
      }
    } catch {
      if (command.includes(rule.pattern)) {
        return { required: true, reason: `Require-approval rule: ${rule.pattern}` };
      }
    }
  }
  if (policy === "allow") return { required: false, reason: "" };
  if (isPlainCommand) {
    for (const rule of allow) {
      try {
        if (new RegExp(rule.pattern, "i").test(command)) {
          return { required: false, reason: "" };
        }
      } catch {
        if (command.startsWith(rule.pattern)) return { required: false, reason: "" };
      }
    }
  }
  return { required: policy === "ask", reason: "Shell policy is ask every time." };
}

function asString(args: Record<string, unknown>, key: string) {
  const v = args[key];
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

function snapshotLabel(snapshot: string, ref: number) {
  return snapshot.split("\n").find((line) => line.startsWith(`[${ref}]`));
}

const pageChangedResult =
  "The page changed since this was approved. Take a new snapshot before continuing.";

const MAX_PROSPECTS_PER_BATCH = 50;
const MAX_ACCEPTANCES_PER_BATCH = 50;
const HEADCOUNT_BANDS: HeadcountBand[] = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "500+",
  "unknown",
];
const DEFAULT_PROSPECT_HEADCOUNT_TARGETS = { A: ["1-10", "11-50"] };

function optionalTrimmed(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return value === undefined || value === null
    ? undefined
    : typeof value === "string"
      ? value.trim()
      : "";
}

function buildProspectEntry(
  args: Record<string, unknown>,
  bot: Bot,
  store: Store
): { ok: true; entry: CrmProspectEntry & { slug: string } } | { ok: false; reason: string } {
  const personName = asString(args, "name");
  const profileUrl = asString(args, "profileUrl");
  const lane = args["lane"];
  const source = args["source"];
  const status = args["status"];
  if (lane !== "A" && lane !== "B") {
    return { ok: false, reason: 'Refused: lane must be "A" or "B".' };
  }
  if (source !== "linkedin" && source !== "inbound") {
    return { ok: false, reason: 'Refused: source must be "linkedin" or "inbound".' };
  }
  if (status !== "queued" && status !== "connected") {
    return { ok: false, reason: 'Refused: status must be "queued" or "connected".' };
  }
  const rawCountry = args["country"];
  const country =
    rawCountry === undefined || rawCountry === null
      ? undefined
      : typeof rawCountry === "string"
        ? rawCountry.trim()
        : "";
  if (country !== undefined && country.length === 0) {
    return { ok: false, reason: "Refused: country must not be empty." };
  }
  const optionalFields = ["company", "role", "headcountSource", "industry"] as const;
  const trimmed = Object.fromEntries(
    optionalFields.map((key) => [key, optionalTrimmed(args, key)])
  ) as Record<(typeof optionalFields)[number], string | undefined>;
  for (const key of optionalFields) {
    if (trimmed[key] !== undefined && trimmed[key].length === 0) {
      return { ok: false, reason: `Refused: ${key} must not be empty.` };
    }
  }
  const rawHeadcount = args["headcount"];
  const headcount = rawHeadcount === undefined || rawHeadcount === null ? undefined : rawHeadcount;
  if (headcount !== undefined && !HEADCOUNT_BANDS.includes(headcount as HeadcountBand)) {
    return { ok: false, reason: `Refused: headcount must be one of ${HEADCOUNT_BANDS.join(", ")}.` };
  }
  if (headcount !== undefined && headcount !== "unknown" && trimmed.headcountSource === undefined) {
    return { ok: false, reason: "Refused: headcountSource is required when headcount is a band." };
  }
  const targets =
    store.settings.prospectHeadcountTargets?.[lane] ??
    (lane === "A" ? DEFAULT_PROSPECT_HEADCOUNT_TARGETS.A : undefined);
  const outOfTarget =
    headcount !== undefined &&
    headcount !== "unknown" &&
    targets !== undefined &&
    targets.length > 0 &&
    !targets.includes(String(headcount))
      ? `Headcount ${headcount} is outside Lane ${lane}'s target (${targets.join(", ")}).`
      : undefined;
  const slug = linkedInProfileSlug(profileUrl);
  if (!slug) {
    return {
      ok: false,
      reason:
        "Refused: profileUrl must be a public LinkedIn profile URL like https://www.linkedin.com/in/<slug>; a Sales Navigator lead URL will not do.",
    };
  }
  return {
    ok: true,
    entry: {
      id: nid("prospect"),
      at: nowIso(),
      botId: bot.id,
      name: personName,
      profileUrl,
      slug,
      lane,
      source,
      status,
      note: asString(args, "note"),
      ...(country !== undefined ? { country } : {}),
      ...(trimmed.company !== undefined ? { company: trimmed.company } : {}),
      ...(trimmed.role !== undefined ? { role: trimmed.role } : {}),
      ...(headcount !== undefined ? { headcount: headcount as HeadcountBand } : {}),
      ...(trimmed.headcountSource !== undefined ? { headcountSource: trimmed.headcountSource } : {}),
      ...(trimmed.industry !== undefined ? { industry: trimmed.industry } : {}),
      ...(outOfTarget ? { outOfTarget } : {}),
    },
  };
}

function isSalesNavLeadUrl(url: string) {
  if (!isLinkedInUrl(url)) return false;
  try {
    return new URL(url).pathname.startsWith("/sales/lead/");
  } catch {
    return false;
  }
}

function validateSalesNavUrl(
  raw: unknown
): { ok: true; value: string | undefined } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const value = typeof raw === "string" ? raw : "";
  if (!isSalesNavLeadUrl(value)) {
    return {
      ok: false,
      reason:
        "Refused: salesNavUrl must be a Sales Navigator lead URL like https://www.linkedin.com/sales/lead/<id>.",
    };
  }
  return { ok: true, value };
}

function buildApproval(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  kind: "shell" | "send" | "takeover",
  title: string
): PendingApproval {
  return {
    id: nid("appr"),
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    botId: ctx.bot.id,
    toolName,
    args,
    createdAt: nowIso(),
    checkpoint: [],
    kind,
    title,
  };
}

function pause(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  kind: "shell" | "send" | "takeover",
  title: string,
  detail: string
): ToolOutcome {
  const approval = buildApproval(ctx, toolName, args, kind, title);
  return { result: `${title} ${detail}`.trim(), approval };
}

function linkedInPacing(store: Store) {
  const window = checkLinkedInSendWindow(
    new Date(),
    store.settings.linkedinSendWindowStart ?? DEFAULT_LINKEDIN_SEND_WINDOW_START,
    store.settings.linkedinSendWindowEnd ?? DEFAULT_LINKEDIN_SEND_WINDOW_END,
    store.settings.linkedinSendWeekdaysOnly ?? DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY
  );
  if (window.status === "refused") return window;
  return checkLinkedInPacing(
    new Date(Date.now() - 1),
    store.settings.linkedinLastActionAt,
    linkedInSendGapSeconds(store.settings)
  );
}

function linkedInSendWindow(store: Store) {
  const now = new Date();
  const start = store.settings.linkedinSendWindowStart ?? DEFAULT_LINKEDIN_SEND_WINDOW_START;
  const end = store.settings.linkedinSendWindowEnd ?? DEFAULT_LINKEDIN_SEND_WINDOW_END;
  const weekdaysOnly = store.settings.linkedinSendWeekdaysOnly ??
    DEFAULT_LINKEDIN_SEND_WEEKDAYS_ONLY;
  const window = checkLinkedInSendWindow(now, start, end, weekdaysOnly);
  if (window.status === "refused") return window;
  const pause = checkLinkedInInvitePause(store.settings, now);
  if (pause.status === "refused") return pause;
  const daily = checkLinkedInInviteCap(
    now,
    store.linkedinSendLog,
    store.settings.linkedinDailyInviteCap ?? DEFAULT_LINKEDIN_DAILY_INVITE_CAP,
    nextLinkedInWindowStart(now, start, end, weekdaysOnly)
  );
  if (daily.status === "refused") return daily;
  return checkLinkedInWeeklyInviteCap(
    now,
    store.linkedinSendLog,
    store.settings.linkedinWeeklyInviteCap ?? DEFAULT_LINKEDIN_WEEKLY_INVITE_CAP
  );
}

function linkedInHoldResult(store: Store, url: string, gateNeeded = false): string | null {
  const reason = automaticLinkedInHoldReason(url, gateNeeded);
  if (!reason) return null;
  store.settings.linkedinHold = `${nowIso()} ${reason}`;
  const decision = checkLinkedInHold(store.settings);
  return decision.status === "refused" ? decision.message : null;
}

function xHoldResult(store: Store, url: string): string | null {
  const reason = automaticXHoldReason(url);
  if (!reason) return null;
  store.settings.xHold = `${nowIso()} ${reason}`;
  const decision = checkXHold(store.settings);
  return decision.status === "refused" ? decision.message : null;
}

function linkedInPageDecision(store: Store, now = new Date()) {
  store.settings.linkedinPageLoads = pruneLinkedInPageLoads(
    store.settings.linkedinPageLoads,
    now
  );
  return checkLinkedInPageBudget(
    now,
    store.settings.linkedinPageLoads,
    store.settings.linkedinDailyPageLoads ?? DEFAULT_LINKEDIN_DAILY_PAGE_LOADS
  );
}

async function runLinkedInAction<T>(
  settings: Store["settings"],
  perform: () => Promise<T>,
  extendTimeout?: (ms: number) => void
): Promise<T> {
  await waitForLinkedInActionGap(settings, () => new Date(), extendTimeout);
  const result = await perform();
  scheduleNextLinkedInAction(settings, new Date());
  return result;
}

async function runXAction<T>(
  settings: Store["settings"],
  perform: () => Promise<T>,
  extendTimeout?: (ms: number) => void
): Promise<T> {
  await waitForXActionGap(settings, () => new Date(), extendTimeout);
  const result = await perform();
  scheduleNextXAction(settings, new Date());
  return result;
}

async function deferSendingOutboxItem(store: Store, nextAllowedAt: Date): Promise<void> {
  const item = (store.outbox ?? []).find((candidate) => candidate.status === "sending");
  if (!item) return;
  item.status = "approved";
  delete item.sendingAt;
  const { deferOutboxRun } = await import("@/lib/outbox-bot");
  deferOutboxRun(store, nextAllowedAt);
}

async function refuseInviteIfLimited(store: Store, bot: Bot, url: string): Promise<string | null> {
  let sentence: string | null = null;
  for (let read = 0; read < 3 && sentence === null; read += 1) {
    try {
      sentence = findLinkedInInviteRefusal(await browserPageText());
    } catch {
      return null;
    }
    if (sentence === null && read < 2) await linkedInBudgetIO.sleep(1000);
  }
  if (!sentence) return null;
  const now = new Date();
  const until = pauseLinkedInInvites(store.settings, sentence, now);
  const slug = linkedInProfileSlug(url);
  const item = (store.outbox ?? []).find((candidate) =>
    candidate.status === "sending" && candidate.kind === "invite"
      && linkedInProfileSlug(candidate.profileUrl) === slug
  );
  if (item) {
    item.status = "approved";
    delete item.sendingAt;
    item.error = `LinkedIn refused this invitation: ${sentence}`;
  }
  forgetTypedText(url);
  store.computerLogs.unshift({
    id: nid("log"), at: nowIso(), botId: bot.id, kind: "browser",
    summary: `LinkedIn refused an invitation: ${sentence}`,
  });
  const { deferOutboxRun } = await import("@/lib/outbox-bot");
  deferOutboxRun(store, until);
  return `LinkedIn refused the invitation: ${sentence} Nothing was recorded as sent. Invites are paused until ${formatSastTime(until)}. End your turn now.`;
}

function recordLinkedInAction(store: Store) {
  noteLinkedInSendPaced(store.settings, nowIso());
}

function outboxFollowUpLine(store: Store, profileUrl: string): string {
  const slug = linkedInProfileSlug(profileUrl);
  if (slug === null) return "Outbox follow-up: none";
  const item = (store.outbox ?? [])
    .filter(
      (candidate) =>
        candidate.kind !== "invite" &&
        linkedInProfileSlug(candidate.profileUrl) === slug
    )
    .at(-1);
  if (!item) return "Outbox follow-up: none";
  return `Outbox follow-up: ${item.status}${item.error ? ` (${item.error})` : ""}`;
}

function draftRefusalFor(store: Store, text: string) {
  const problems = findDraftProblems(
    text,
    store.settings.draftBannedPhrases ?? DEFAULT_BANNED_PHRASES
  );
  return problems.length ? draftCheckRefusal(problems) : null;
}

export interface ToolContext {
  store: Store;
  bot: Bot;
  conversationId: string;
  messageId: string;
  extendTimeout?: (ms: number) => void;
}

export interface ToolOutcome {
  result: string;
  image?: { data: string; mimeType: string };
  approval?: PendingApproval;
  file?: { path: string; action: "created" | "updated" | "read" };
  handoff?: { toBotId: string; note: string };
  browse?: { url: string; title: string; excerpt: string };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const { store, bot } = ctx;

  if (name === "list_files") {
    const rel = asString(args, "path") || ".";
    const tree = await listTree(rel, 3);
    const flatten = (nodes: typeof tree, indent = ""): string =>
      nodes
        .map((n) => {
          const line = `${indent}${n.type === "dir" ? n.name + "/" : n.name}`;
          return n.children?.length ? `${line}\n${flatten(n.children, indent + "  ")}` : line;
        })
        .join("\n");
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "file",
      summary: `Listed ${rel}`,
    });
    return { result: flatten(tree) || "(empty)" };
  }

  if (name === "read_file") {
    const rel = asString(args, "path");
    const content = await readComputerFile(rel);
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "file",
      summary: `Read ${rel}`,
    });
    return { result: content, file: { path: rel, action: "read" } };
  }

  if (name === "search_files") {
    const query = asString(args, "query");
    const rel = asString(args, "path") || ".";
    const { matches, truncated } = await searchComputerFiles(query, {
      path: rel,
      regex: args.regex === true,
      ignoreCase: args.ignoreCase === true,
    });
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "file",
      summary: `Searched files for "${query}"`,
    });
    if (matches.length === 0) return { result: "No matches." };
    const lines = matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
    if (truncated) lines.push("(more matches not shown)");
    return { result: lines.join("\n") };
  }

  if (name === "write_file") {
    const rel = asString(args, "path");
    const content = asString(args, "content");
    const { rel: normalizedRel } = await resolveInComputer(rel);
    if (normalizedRel.split("/")[0]?.toLowerCase() === "drafts") {
      const refusal = draftRefusalFor(store, content);
      if (refusal) return { result: refusal };
    }
    const written = await writeComputerFile(rel, content);
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "file",
      summary: `${written.action === "created" ? "Created" : "Updated"} ${written.path}`,
    });
    return {
      result: `${written.action} ${written.path} (${content.length} chars)`,
      file: written,
    };
  }

  if (name === "run_command") {
    const command = asString(args, "command");
    const gate = needsApproval(command, store.settings.shellPolicy, store.settings.autoReview);
    if (store.settings.shellPolicy === "never") {
      return { result: "Shell is disabled in Settings. The user must change the local shell policy." };
    }
    if (gate.required) {
      return pause(ctx, "run_command", { command }, "shell", "Run this on the computer?", command);
    }
    const ran = await runCommand(command);
    const output = [ran.stdout, ran.stderr].filter(Boolean).join("\n").trim() || "(no output)";
    store.terminalSessions.unshift({
      id: nid("term"),
      at: nowIso(),
      botId: bot.id,
      command,
      output: output.slice(0, 20_000),
      exitCode: ran.exitCode,
    });
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "command",
      summary: `$ ${command}`,
      detail: output.slice(0, 2000),
    });
    return { result: `exit ${ran.exitCode}\n${output.slice(0, 12_000)}` };
  }

  if (name === "web_search") {
    const query = asString(args, "query");
    const hits = await webSearch(query);
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "search",
      summary: `Searched “${query}”`,
    });
    if (!hits.length) return { result: "No results. Try a more specific query, or browse a known URL." };
    return {
      result: hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n\n"),
    };
  }

  if (name === "browse_url") {
    const url = asString(args, "url");
    if (isLinkedInUrl(url)) {
      return {
        result: "LinkedIn page budget: use the shared browser for LinkedIn pages, not browse_url.",
      };
    }
    const page = await fetchUrl(url);
    const excerpt = page.text.slice(0, 12_000);
    store.browseSnapshots.unshift({
      id: nid("web"),
      at: nowIso(),
      botId: bot.id,
      url: page.url,
      title: page.title,
      excerpt: page.text.slice(0, 800),
    });
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "browse",
      summary: page.title,
      url: page.url,
    });
    return {
      result: `Title: ${page.title}\nURL: ${page.url}\nStatus: ${page.status}\n\n${excerpt}`,
      browse: { url: page.url, title: page.title, excerpt: page.text.slice(0, 800) },
    };
  }

  if (name === "remember") {
    const note = asString(args, "note").trim();
    bot.memory = bot.memory ? `${bot.memory.trim()}\n- ${note}` : `- ${note}`;
    return { result: "Saved to this Bot's memory." };
  }

  if (name === "save_skill") {
    const nameArg = asString(args, "name");
    const body = asString(args, "body");
    const slug = slugify(nameArg);
    const existing = store.skills.find((s) => s.slug === slug);
    if (existing) {
      existing.name = nameArg;
      existing.body = body;
      return { result: `Updated skill /${slug}` };
    }
    store.skills.push({
      id: nid("skill"),
      name: nameArg,
      slug,
      body,
      createdAt: nowIso(),
    });
    return { result: `Saved skill /${slug}. The team can invoke it with /${slug}.` };
  }

  if (name === "message_bot") {
    const target = asString(args, "bot");
    const note = asString(args, "note");
    const found = store.bots.find(
      (b) =>
        !b.archived &&
        (b.id === target || b.name.toLowerCase() === target.toLowerCase())
    );
    if (!found) return { result: `No Bot named ${target}.` };
    if (found.id === bot.id) return { result: "You already own this. Keep going." };
    return {
      result: `Handed to ${found.name}.`,
      handoff: { toBotId: found.id, note },
    };
  }

  if (name === "call_plugin") {
    const pluginKey = asString(args, "plugin");
    const method = (asString(args, "method") || "GET").toUpperCase();
    const pth = asString(args, "path") || "/";
    const body = asString(args, "body");
    const plugin = store.plugins.find(
      (p) => p.id === pluginKey || p.name.toLowerCase() === pluginKey.toLowerCase()
    );
    if (!plugin) return { result: "No such plugin. Add one in Settings → Plugins." };
    const url = `${plugin.baseUrl.replace(/\/$/, "")}/${pth.replace(/^\//, "")}`;
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...plugin.headers,
      },
      body: ["POST", "PUT", "PATCH"].includes(method) && body ? body : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "plugin",
      summary: `${plugin.name} ${method} ${pth}`,
    });
    return { result: `${res.status} ${res.statusText}\n${text.slice(0, 8000)}` };
  }

  if (name === "queue_linkedin_message") {
    try {
      const prospectSlug = linkedInProfileSlug(asString(args, "profileUrl"));
      const outOfTargetProspect = prospectSlug
        ? store.crmProspects?.find(
            (prospect) =>
              linkedInProfileSlug(prospect.profileUrl) === prospectSlug && prospect.outOfTarget
          )
        : undefined;
      if (outOfTargetProspect?.outOfTarget) {
        return {
          result: `Refused: ${asString(args, "name") || outOfTargetProspect.name} is out of target: ${outOfTargetProspect.outOfTarget}`,
        };
      }
      const laneArg = args["lane"];
      const lane = laneArg === "A" || laneArg === "B" ? laneArg : undefined;
      const kind = args["kind"] === "invite" ? "invite" : undefined;
      const note = typeof args["note"] === "string" ? args["note"] : undefined;
      const item = createOutboxItem(store, {
        name: asString(args, "name"),
        profileUrl: asString(args, "profileUrl"),
        text: asString(args, "text"),
        kind,
        note,
        lane,
        createdBy: bot.id,
      });
      return { result: `Queued for approval: ${item.name}` };
    } catch (error) {
      return { result: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === "record_x_reply") {
    try {
      const item = createXReply(store, {
        postUrl: asString(args, "postUrl"),
        author: asString(args, "author"),
        postExcerpt: asString(args, "postExcerpt"),
        text: asString(args, "text"),
        note: typeof args.note === "string" ? args.note : undefined,
        postAt: typeof args.postAt === "string" ? args.postAt : undefined,
        createdBy: bot.id,
      });
      return {
        result: `Saved X reply draft for @${item.author.replace(/^@/, "")}. The operator posts it by hand; nothing was posted.`,
      };
    } catch (error) {
      return { result: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === "record_company_candidate") {
    try {
      const item = recordCompanyCandidate(store, {
        domain: args.domain,
        name: args.name,
        lane: args.lane,
        verdict: args.verdict,
        criteria: args.criteria,
        createdBy: bot.id,
      });
      return {
        result: `Recorded company candidate ${item.id}: ${item.domain}, lane ${item.lane}, verdict ${item.verdict}.`,
      };
    } catch (error) {
      return { result: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === "list_company_candidates") {
    const hasDomain = typeof args.domain === "string";
    const domain = hasDomain ? normalizeCompanyDomain(args.domain) : null;
    const matches = (store.companyCandidates ?? []).filter(
      (item) =>
        (!hasDomain || (domain !== null && normalizeCompanyDomain(item.domain) === domain)) &&
        (args.lane === undefined || item.lane === args.lane) &&
        (args.verdict === undefined || item.verdict === args.verdict)
    );
    return {
      result:
        matches.length > 0
          ? matches.map(formatCompanyCandidate).join("\n\n")
          : "No company candidates match.",
    };
  }

  if (name === "record_linkedin_prospect") {
    const built = buildProspectEntry(args, bot, store);
    if (!built.ok) return { result: built.reason };
    store.crmProspects = store.crmProspects ?? [];
    store.crmProspects.push(built.entry);
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "search",
      summary: `Recorded prospect ${built.entry.name}`,
    });
    return { result: `Recorded ${built.entry.name} in the CRM (not contacted).` };
  }

  if (name === "record_linkedin_prospects") {
    const raw = args["prospects"];
    const items = Array.isArray(raw) ? raw : [];
    if (items.length === 0) {
      return { result: "Refused: prospects must be a non-empty array." };
    }

    store.crmProspects = store.crmProspects ?? [];
    const crmProspects = store.crmProspects;
    const seenSlugs = new Map<string, string>();
    const refusals: string[] = [];
    let recorded = 0;

    items.forEach((rawItem, index) => {
      const position = index + 1;
      const item =
        rawItem !== null && typeof rawItem === "object" && !Array.isArray(rawItem)
          ? (rawItem as Record<string, unknown>)
          : {};
      const itemName = asString(item, "name").trim();
      const label = itemName || `item ${position}`;

      if (index >= MAX_PROSPECTS_PER_BATCH) {
        refusals.push(
          `item ${position}: Refused: only ${MAX_PROSPECTS_PER_BATCH} prospects can be recorded in one call.`
        );
        return;
      }

      const built = buildProspectEntry(item, bot, store);
      if (!built.ok) {
        refusals.push(`${label}: ${built.reason}`);
        return;
      }

      const salesNav = validateSalesNavUrl(item["salesNavUrl"]);
      if (!salesNav.ok) {
        refusals.push(`${label}: ${salesNav.reason}`);
        return;
      }

      const firstLabel = seenSlugs.get(built.entry.slug);
      if (firstLabel) {
        refusals.push(`${label}: Refused: duplicate of ${firstLabel}.`);
        return;
      }

      if (salesNav.value !== undefined) built.entry.salesNavUrl = salesNav.value;
      crmProspects.push(built.entry);
      seenSlugs.set(built.entry.slug, label);
      recorded += 1;
    });

    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "search",
      summary: `Recorded ${recorded} prospects, refused ${refusals.length}`,
    });
    const lines = [`Recorded ${recorded} in the CRM (not contacted).`];
    if (refusals.length > 0) {
      lines.push(`Refused ${refusals.length}:`);
      refusals.forEach((refusal) => lines.push(`- ${refusal}`));
    }
    return { result: lines.join("\n") };
  }

  if (name === "record_linkedin_thread") {
    const profileUrl = asString(args, "profileUrl");
    const slug = linkedInProfileSlug(profileUrl);
    const item = (store.outbox ?? []).find(
      (candidate) =>
        candidate.status === "sending" &&
        slug != null &&
        linkedInProfileSlug(candidate.profileUrl) === slug
    );
    if (!item) {
      return { result: `No sending Outbox item matched ${profileUrl}; nothing was recorded.` };
    }

    const lastFromOperatorAt = asString(args, "lastFromOperatorAt");
    const lastFromOperatorLine = asString(args, "lastFromOperatorLine");
    item.threadRead = {
      at: nowIso(),
      ...(lastFromOperatorAt && { lastFromOperatorAt }),
      ...(lastFromOperatorLine && { lastFromOperatorLine }),
    };

    if (lastFromOperatorAt) {
      const lastMessageTime = new Date(lastFromOperatorAt).getTime();
      const { onOutboxItemSettled, outboxRecentMessageDays } = await import(
        "@/lib/outbox-bot"
      );
      const windowMs = outboxRecentMessageDays(store) * 24 * 60 * 60 * 1000;
      if (Number.isFinite(lastMessageTime) && Date.now() - lastMessageTime <= windowMs) {
        const date = new Date(lastMessageTime).toISOString().slice(0, 10);
        item.status = "failed";
        item.error = `Already messaged on ${date}: ${lastFromOperatorLine}`;
        store.computerLogs.unshift({
          id: nid("log"),
          at: nowIso(),
          botId: "outbox",
          kind: "browser",
          summary: `Outbox skipped ${item.name}: the already-messaged guard refused it (${item.error}). The run carries on with the next approved item.`,
        });
        onOutboxItemSettled(store, "skipped");
        void measureOutboxAftermath(item.id).catch(() => {});
        return {
          result: `Stopped the send to ${item.name}: ${item.error}`,
        };
      }
    }

    return { result: `Recorded the conversation with ${item.name}.` };
  }

  if (name === "record_invite_already_sent") {
    const profileUrl = asString(args, "profileUrl");
    const evidence = asString(args, "evidence").trim();
    const slug = linkedInProfileSlug(profileUrl);
    const item = (store.outbox ?? []).find(
      (candidate) =>
        candidate.status === "sending" &&
        candidate.kind === "invite" &&
        slug != null &&
        linkedInProfileSlug(candidate.profileUrl) === slug
    );
    if (!item || !evidence) {
      return { result: `No sending invite matched ${profileUrl}; nothing was recorded.` };
    }

    confirmOutboxItemSent(store, {
      id: item.id,
      evidence: `${bot.name}: ${evidence}`,
    });
    const { onOutboxItemSettled } = await import("@/lib/outbox-bot");
    onOutboxItemSettled(store, "sent");
    return {
      result: `Recorded the invitation to ${item.name} as already sent (Pending on LinkedIn).`,
    };
  }

  if (name === "list_linkedin_prospects") {
    reconcileInviteProspects(store);
    const lane = args["lane"];
    if (lane !== undefined && lane !== "A" && lane !== "B") {
      return { result: 'Refused: lane must be "A" or "B".' };
    }
    const status = args["status"];
    const statuses = ["queued", "connected", "pending", "messaged", "accepted"];
    if (status !== undefined && !statuses.includes(String(status))) {
      return { result: "Refused: invalid status." };
    }
    const rawHeadcounts = args["headcount"];
    if (
      rawHeadcounts !== undefined &&
      (!Array.isArray(rawHeadcounts) ||
        rawHeadcounts.some((band) => !HEADCOUNT_BANDS.includes(band as HeadcountBand)))
    ) {
      return { result: "Refused: headcount must be an array of valid bands." };
    }
    const industry = args["industry"];
    if (industry !== undefined && typeof industry !== "string") {
      return { result: "Refused: industry must be a string." };
    }
    const countryFilter = args["country"];
    if (countryFilter !== undefined && typeof countryFilter !== "string") {
      return { result: "Refused: country must be a string." };
    }
    const outOfTargetFilter = args["outOfTarget"];
    if (outOfTargetFilter !== undefined && typeof outOfTargetFilter !== "boolean") {
      return { result: "Refused: outOfTarget must be a boolean." };
    }
    const rawSlugs = args["slugs"];
    if (rawSlugs !== undefined && !Array.isArray(rawSlugs)) {
      return { result: "Refused: slugs must be an array." };
    }
    if (Array.isArray(rawSlugs) && rawSlugs.length > 50) {
      return { result: "Refused: at most 50 slugs can be requested at once." };
    }
    const requestedSlugs = Array.isArray(rawSlugs)
      ? [
          ...new Set(
            rawSlugs
              .filter((slug): slug is string => typeof slug === "string")
              .map((slug) => slug.trim().toLowerCase())
          ),
        ]
      : undefined;
    const requestedSlugSet = requestedSlugs ? new Set(requestedSlugs) : undefined;
    const headcounts = rawHeadcounts as HeadcountBand[] | undefined;
    const normalizedIndustry =
      typeof industry === "string" ? industry.toLowerCase() : undefined;
    const normalizedCountry =
      typeof countryFilter === "string" ? countryFilter.trim().toLowerCase() : undefined;
    const requestedLimit =
      typeof args["limit"] === "number" && Number.isFinite(args["limit"])
        ? Math.trunc(args["limit"])
        : 50;
    const limit = Math.min(Math.max(requestedLimit, 1), 200);
    const prospects = [...(store.crmProspects ?? [])]
      .reverse()
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .filter(
        (prospect) =>
          (requestedSlugSet === undefined ||
            (prospect.slug != null && requestedSlugSet.has(prospect.slug.trim().toLowerCase()))) &&
          (lane === undefined || prospect.lane === lane) &&
          (status === undefined || prospect.status === status) &&
          (headcounts === undefined || (prospect.headcount !== undefined && headcounts.includes(prospect.headcount))) &&
          (normalizedIndustry === undefined || prospect.industry?.toLowerCase().includes(normalizedIndustry) === true) &&
          (normalizedCountry === undefined || prospect.country?.trim().toLowerCase() === normalizedCountry) &&
          (outOfTargetFilter === undefined || Boolean(prospect.outOfTarget) === outOfTargetFilter)
      );
    const limitedProspects = requestedSlugs === undefined ? prospects.slice(0, limit) : prospects;
    const allProspectSlugs = new Set(
      (store.crmProspects ?? [])
        .map((prospect) => prospect.slug?.trim().toLowerCase())
        .filter((slug): slug is string => slug != null)
    );
    const notFound = (requestedSlugs ?? [])
      .filter((slug) => !allProspectSlugs.has(slug))
      .map((slug) => `${slug}: not found`);
    if (limitedProspects.length === 0 && notFound.length === 0) {
      return { result: "No matching prospects." };
    }
    return {
      result: [
        ...limitedProspects.map(
          (prospect) =>
            `${prospect.name}\nProfile: ${prospect.profileUrl}\nSlug: ${prospect.slug ?? "(none)"}\nLane: ${prospect.lane}\nSource: ${prospect.source}\nStatus: ${prospect.status}\nCountry: ${prospect.country ?? "(unknown)"}${prospect.company !== undefined ? `\nCompany: ${prospect.company}` : ""}${prospect.role !== undefined ? `\nRole: ${prospect.role}` : ""}${prospect.headcount !== undefined ? `\nHeadcount: ${prospect.headcount}` : ""}${prospect.headcountSource !== undefined ? `\nHeadcount source: ${prospect.headcountSource}` : ""}${prospect.industry !== undefined ? `\nIndustry: ${prospect.industry}` : ""}${prospect.outOfTarget !== undefined ? `\nOut of target: ${prospect.outOfTarget}` : ""}\nNote: ${prospect.note}\n${outboxFollowUpLine(store, prospect.profileUrl)}`
        ),
        ...notFound,
      ].join("\n\n"),
    };
  }

  if (name === "record_linkedin_acceptances") {
    reconcileInviteProspects(store);
    const raw = args["slugs"];
    if (!Array.isArray(raw) || raw.length === 0) {
      return { result: "Refused: slugs must be a non-empty array." };
    }

    const lines: string[] = [];
    let recorded = 0;
    for (const [index, rawSlug] of raw.entries()) {
      if (index >= MAX_ACCEPTANCES_PER_BATCH) {
        lines.push(
          `item ${index + 1}: Refused: only ${MAX_ACCEPTANCES_PER_BATCH} slugs can be recorded in one call.`
        );
        continue;
      }
      const slug = typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : "";
      const prospect = store.crmProspects?.find((candidate) => candidate.slug === slug);
      if (!prospect) {
        lines.push(`${slug}: not found`);
        continue;
      }
      prospect.status = "accepted";
      if (!prospect.acceptedAt) {
        prospect.acceptedAt = nowIso();
        prospect.acceptedAtSource = "first-seen";
      }
      const sync = await syncProspectAcceptance(prospect, {
        fetchFn: fetch,
        env: process.env,
      });
      prospect.acceptedSync = { ...sync, at: nowIso() };
      recorded += 1;
      lines.push(
        sync.state === "synced"
          ? `${slug}: updated locally, updated in Notion (lane ${prospect.lane})`
          : `${slug}: updated locally, Notion not updated (${sync.state}) (lane ${prospect.lane})`
      );
    }
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "search",
      summary: `Recorded ${recorded} LinkedIn acceptances`,
    });
    return { result: lines.join("\n") };
  }

  if (name === "invite_note_report") {
    const rows = inviteNoteReport(store, new Date());
    if (rows.length === 0) return { result: "No sent invites recorded." };
    return {
      result: [
        ...rows.map(
          (row) =>
            `lane ${row.lane} ${row.variant}: sent ${row.sent}, accepted ${row.accepted}, accepted within 14 days ${row.within14}, younger than 14 days ${row.younger}`
        ),
        "Acceptance dates are when Homestead first saw the acceptance, not when it happened.",
      ].join("\n"),
    };
  }

  if (name === "browser_navigate") {
    const url = asString(args, "url");
    const linkedIn = isLinkedInUrl(url);
    const xTarget = isXUrl(url);
    if (xTarget) {
      const hold = checkXHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
      const now = new Date();
      store.settings.xPageLoads = pruneXPageLoads(store.settings.xPageLoads, now);
      const decision = checkXPageBudget(
        now,
        store.settings.xPageLoads,
        store.settings.xDailyPageLoads ?? DEFAULT_X_DAILY_PAGE_LOADS
      );
      if (decision.status === "refused") return { result: decision.message };
    }
    const holdBeforeLoad = checkLinkedInHold(store.settings);
    const budgetBeforeLoad = linkedInPageDecision(store);
    if (linkedIn) {
      if (holdBeforeLoad.status === "refused") return { result: holdBeforeLoad.message };
      if (budgetBeforeLoad.status === "refused") return { result: budgetBeforeLoad.message };
    }
    const nav = xTarget
      ? await runXAction(store.settings, () => browserNavigate(url), ctx.extendTimeout)
      : linkedIn
        ? await runLinkedInAction(store.settings, () => browserNavigate(url), ctx.extendTimeout)
        : await browserNavigate(url);
    if (nav.blocked) return { result: nav.result };
    if (isXUrl(nav.url)) recordXPageLoad(store.settings, new Date());
    if (isLinkedInUrl(nav.url)) recordLinkedInPageLoad(store.settings, new Date());
    if (isXUrl(nav.url)) {
      const holdResult = xHoldResult(store, nav.url);
      if (holdResult) return { result: holdResult };
    }
    if (!linkedIn && isLinkedInUrl(nav.url)) {
      if (holdBeforeLoad.status === "refused") return { result: holdBeforeLoad.message };
      if (budgetBeforeLoad.status === "refused") return { result: budgetBeforeLoad.message };
    }
    const holdResult = linkedInHoldResult(store, nav.url, nav.gate.needed);
    if (holdResult) return { result: holdResult };
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "browser",
      summary: `Opened ${nav.title || url}`,
      url: nav.url,
    });
    if (nav.gate.needed) {
      await setBrowserMode("human", nav.gate.reason);
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: bot.id,
        kind: "browser",
        summary: `Human gate: ${nav.gate.signal}${nav.gate.detail ? ` (${nav.gate.detail})` : ""}`,
      });
      return pause(
        ctx,
        "request_takeover",
        { reason: nav.gate.reason, url: nav.url },
        "takeover",
        "The browser needs you",
        `${nav.gate.reason}\n\nOpen Computer → Browser. Sign in there (2FA and CAPTCHA included). Don't paste secrets into chat. Then continue.`
      );
    }
    return { result: nav.snapshot };
  }

  if (name === "browser_snapshot") {
    const snap = await browserSnapshot();
    if (snap.gate.needed) {
      await setBrowserMode("human", snap.gate.reason);
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: bot.id,
        kind: "browser",
        summary: `Human gate: ${snap.gate.signal}${snap.gate.detail ? ` (${snap.gate.detail})` : ""}`,
      });
      return pause(
        ctx,
        "request_takeover",
        { reason: snap.gate.reason, url: snap.url },
        "takeover",
        "The browser needs you",
        `${snap.gate.reason}\n\nOpen Computer → Browser, finish the human step, then continue.`
      );
    }
    return { result: snap.snapshot };
  }

  if (name === "browser_screenshot") {
    const look = await browserLook();
    if (look.gate.needed) {
      await setBrowserMode("human", look.gate.reason);
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: bot.id,
        kind: "browser",
        summary: `Human gate: ${look.gate.signal}${look.gate.detail ? ` (${look.gate.detail})` : ""}`,
      });
      return pause(
        ctx,
        "request_takeover",
        { reason: look.gate.reason, url: look.url },
        "takeover",
        "The browser needs you",
        `${look.gate.reason}\n\nOpen Computer → Browser, finish the human step, then continue.`
      );
    }
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "browser",
      summary: `Looked at ${look.title || look.url}`,
      url: look.url,
    });
    return {
      result: `URL: ${look.url}\nTitle: ${look.title}\n${look.legend}`,
      image: { data: look.image, mimeType: "image/jpeg" },
    };
  }

  if (name === "browser_click") {
    const ref = typeof args.ref === "number" ? args.ref : Number(args.ref);
    const x = typeof args.x === "number" ? args.x : undefined;
    const y = typeof args.y === "number" ? args.y : undefined;
    const preview = await browserSnapshot();
    const hasRef = Number.isFinite(ref);
    const label = hasRef ? snapshotLabel(preview.snapshot, ref) : undefined;
    const onX = isXUrl(preview.url);
    if (onX) {
      const automaticHold = xHoldResult(store, preview.url);
      if (automaticHold) return { result: automaticHold };
      const hold = checkXHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
    }
    const xRefusal = xBrowserRefusal("browser_click", preview.url, label);
    if (xRefusal) return { result: xRefusal };
    const linkedIn = isLinkedInUrl(preview.url);
    if (linkedIn) {
      const automaticHold = linkedInHoldResult(store, preview.url, preview.gate.needed);
      if (automaticHold) return { result: automaticHold };
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
      const budget = linkedInPageDecision(store);
      if (budget.status === "refused") return { result: budget.message };
    }
    const detail = label || `click ${x},${y}`;
    const isSend =
      (hasRef && label != null && looksLikeSend(label)) ||
      (!hasRef && x != null && y != null);
    const nothingSending = !(store.outbox ?? []).some(
      (candidate) => candidate.status === "sending"
    );
    const quotedText = quotedLabelText(label)?.trim().toLowerCase();
    if (
      linkedIn &&
      nothingSending &&
      (isSend ||
        (hasRef &&
          label != null &&
          (quotedText?.startsWith("message") ||
            label.toLowerCase().includes("/preload/custom-invite/"))))
    ) {
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: bot.id,
        kind: "browser",
        summary: `Refused LinkedIn send click outside the Outbox: ${detail}`,
      });
      return {
        result: `Refused: ${detail}. No Outbox item is sending. LinkedIn invitations and messages are sent only through the Outbox. Do not click it or ask the operator to approve it. Record the person and stop.`,
      };
    }
    if (
      !hasRef &&
      x != null &&
      y != null &&
      (store.outbox ?? []).some((candidate) => candidate.status === "sending")
    ) {
      return {
        result:
          "An Outbox item is sending. Take a browser_snapshot and click by ref \u2014 a click with only x,y records nothing and cannot finish the item.",
      };
    }
    if (
      isSend &&
      isLinkedInUrl(preview.url) &&
      isLinkedInSendAction({ kind: "click", label })
    ) {
      const confirmation = isInviteConfirmation(store, preview.url, label ?? null, new Date());
      const decision = confirmation ? linkedInSendWindow(store) : linkedInPacing(store);
      if (decision.status === "refused") {
        await deferSendingOutboxItem(store, decision.nextAllowedAt);
        return { result: decision.message };
      }
    }
    if (isSend) {
      const approvalArgs = hasRef ? { ref, label } : { x, y };
      const sending = (store.outbox ?? []).some((candidate) => candidate.status === "sending");
      if (
        hasRef &&
        isOutboxPreapproved(store, {
          tool: "browser_click",
          url: preview.url,
          label: label ?? null,
          hasRef,
          composeText: sending ? await browserComposeText() : null,
        })
      ) {
        const approval = buildApproval(
          ctx,
          "browser_click",
          approvalArgs,
          "send",
          "Approve browser click?"
        );
        const item = store.outbox?.find((candidate) => candidate.status === "sending");
        store.computerLogs.unshift({
          id: nid("log"),
          at: nowIso(),
          botId: bot.id,
          kind: "browser",
          summary: `Outbox pre-approved: ${item?.name ?? ""}`,
        });
        return { result: await executeApprovedAction(approval, ctx.bot, ctx.store, ctx.extendTimeout) };
      }
      return pause(
        ctx,
        "browser_click",
        approvalArgs,
        "send",
        "Approve browser click?",
        detail
      );
    }
    const click = () => browserClick({ ref: Number.isFinite(ref) ? ref : undefined, x, y });
    const clicked = onX
      ? await runXAction(store.settings, click, ctx.extendTimeout)
      : linkedIn
        ? await runLinkedInAction(store.settings, click, ctx.extendTimeout)
        : await click();
    const clickedUrl = "url" in clicked && typeof clicked.url === "string" ? clicked.url : undefined;
    if (!clicked.blocked && linkedIn && clickedUrl && linkedInPathChanged(preview.url, clickedUrl)) {
      recordLinkedInPageLoad(store.settings, new Date());
    }
    if (!clicked.blocked && clickedUrl) {
      if (onX) {
        const holdResult = xHoldResult(store, clickedUrl);
        if (holdResult) return { result: holdResult };
      }
      const holdResult = linkedInHoldResult(store, clickedUrl);
      if (holdResult) return { result: holdResult };
    }
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "browser",
      summary: clicked.label ? `Clicked “${clicked.label}”` : "Clicked in the browser",
    });
    return { result: clicked.result };
  }

  if (name === "browser_type") {
    const text = asString(args, "text");
    if (/password|passwd|one-time|otp|2fa/i.test(text)) {
      await setBrowserMode("human", "A secret was about to be typed in chat.");
      return pause(
        ctx,
        "request_takeover",
        { reason: "secret" },
        "takeover",
        "The browser needs you",
        "Don't paste passwords into chat. Open Computer → Browser and type the secret there, then continue."
      );
    }
    const refusal = draftRefusalFor(store, text);
    if (refusal) return { result: refusal };
    const ref = typeof args.ref === "number" ? args.ref : undefined;
    const hasRef = ref != null && Number.isFinite(ref);
    let label: string | undefined;
    let currentUrl: string | undefined;
    let currentGateNeeded = false;
    if (hasRef) {
      const snap = await browserSnapshot();
      label = snapshotLabel(snap.snapshot, ref);
      currentUrl = snap.url;
      currentGateNeeded = snap.gate.needed;
    }
    const isSend = /[\n\r]/.test(text) || (label != null && looksLikeSend(label));
    if (currentUrl == null) {
      const snap = await browserSnapshot();
      currentUrl = snap.url;
      currentGateNeeded = snap.gate.needed;
    }
    const xRefusal = xBrowserRefusal("browser_type", currentUrl);
    if (xRefusal) return { result: xRefusal };
    const preapprovalUrl = currentUrl;
    if (isLinkedInUrl(preapprovalUrl)) {
      const automaticHold = linkedInHoldResult(store, preapprovalUrl, currentGateNeeded);
      if (automaticHold) return { result: automaticHold };
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
    }
    if (isSend) {
      if (
        isLinkedInUrl(preapprovalUrl) &&
        isLinkedInSendAction({ kind: "type", text })
      ) {
        const decision = linkedInPacing(store);
        if (decision.status === "refused") {
          await deferSendingOutboxItem(store, decision.nextAllowedAt);
          return { result: decision.message };
        }
      }
    }
    if (isOutboxSendText(store, preapprovalUrl, text)) {
      const item = (store.outbox ?? []).filter((candidate) => candidate.status === "sending")[0];
      if (item.kind === "message" && !item.threadRead) {
        return {
          result: `Open ${item.name}'s conversation from their profile and call record_linkedin_thread before sending.`,
        };
      }
      if (store.settings.outboxSendWithoutFinalApproval) {
        const approval = buildApproval(
          ctx,
          "browser_type",
          hasRef ? { text, ref, label } : { text },
          "send",
          `Send to ${item.name}?`
        );
        store.computerLogs.unshift({
          id: nid("log"),
          at: nowIso(),
          botId: bot.id,
          kind: "browser",
          summary: `Outbox approved text typed: ${item.name}`,
        });
        return { result: await executeApprovedAction(approval, ctx.bot, ctx.store, ctx.extendTimeout) };
      }
      return pause(
        ctx,
        "browser_type",
        hasRef ? { text, ref, label } : { text },
        "send",
        `Send to ${item.name}?`,
        text
      );
    }
    if (isSend) {
      if (
        preapprovalUrl &&
        isOutboxPreapproved(store, {
          tool: "browser_type",
          url: preapprovalUrl,
          text,
        })
      ) {
        const approval = buildApproval(
          ctx,
          "browser_type",
          hasRef ? { text, ref, label } : { text },
          "send",
          "Approve browser typing?"
        );
        const item = store.outbox?.find((candidate) => candidate.status === "sending");
        store.computerLogs.unshift({
          id: nid("log"),
          at: nowIso(),
          botId: bot.id,
          kind: "browser",
          summary: `Outbox pre-approved: ${item?.name ?? ""}`,
        });
        return { result: await executeApprovedAction(approval, ctx.bot, ctx.store, ctx.extendTimeout) };
      }
      return pause(
        ctx,
        "browser_type",
        hasRef ? { text, ref, label } : { text },
        "send",
        "Approve browser typing?",
        label || `Type ${JSON.stringify(text)}`
      );
    }
    const type = () => browserType(text, hasRef ? ref : undefined);
    const typed = preapprovalUrl && isLinkedInUrl(preapprovalUrl)
      ? await runLinkedInAction(store.settings, type, ctx.extendTimeout)
      : await type();
    if (
      isLinkedInUrl(preapprovalUrl) &&
      "url" in typed &&
      typeof typed.url === "string"
    ) {
      const holdResult = linkedInHoldResult(store, typed.url);
      if (holdResult) return { result: holdResult };
    }
    if (!typed.blocked && typed.url && isLinkedInUrl(typed.url)) {
      rememberTypedText(typed.url, text);
    }
    return { result: typed.result };
  }

  if (name === "browser_press") {
    const key = asString(args, "key") || "Enter";
    const preview = await browserSnapshot();
    const xRefusal = xBrowserRefusal("browser_press", preview.url);
    if (xRefusal) return { result: xRefusal };
    const linkedIn = isLinkedInUrl(preview.url);
    if (linkedIn) {
      const automaticHold = linkedInHoldResult(store, preview.url, preview.gate.needed);
      if (automaticHold) return { result: automaticHold };
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
    }
    if (isLinkedInSendAction({ kind: "press", key })) {
      if (linkedIn) {
          const decision = linkedInPacing(store);
          if (decision.status === "refused") {
            await deferSendingOutboxItem(store, decision.nextAllowedAt);
            return { result: decision.message };
          }
      }
      return pause(
        ctx,
        "browser_press",
        { key },
        "send",
        "Approve browser keypress?",
        `Press ${key}`
      );
    }
    const press = () => browserPress(key);
    const pressed = linkedIn
      ? await runLinkedInAction(store.settings, press, ctx.extendTimeout)
      : await press();
    if (pressed.blocked) return { result: pressed.result };
    if (linkedIn && "url" in pressed && typeof pressed.url === "string") {
      const holdResult = linkedInHoldResult(store, pressed.url);
      if (holdResult) return { result: holdResult };
    }
    return { result: pressed.result };
  }

  if (name === "browser_scroll") {
    const direction = asString(args, "direction") === "up" ? "up" : "down";
    const ref = typeof args.ref === "number" ? args.ref : Number(args.ref);
    const hasRef = Number.isFinite(ref);
    const preview = await browserSnapshot();
    const onX = isXUrl(preview.url);
    if (onX) {
      const automaticHold = xHoldResult(store, preview.url);
      if (automaticHold) return { result: automaticHold };
      const hold = checkXHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
    }
    const linkedIn = isLinkedInUrl(preview.url);
    if (linkedIn) {
      const automaticHold = linkedInHoldResult(store, preview.url, preview.gate.needed);
      if (automaticHold) return { result: automaticHold };
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return { result: hold.message };
    }
    const scroll = () => browserScroll(direction, hasRef ? ref : undefined);
    const scrolled = onX
      ? await runXAction(store.settings, scroll, ctx.extendTimeout)
      : linkedIn
        ? await runLinkedInAction(store.settings, scroll, ctx.extendTimeout)
        : await scroll();
    if (scrolled.blocked) return { result: scrolled.result };
    if (linkedIn && "url" in scrolled && typeof scrolled.url === "string") {
      const holdResult = linkedInHoldResult(store, scrolled.url);
      if (holdResult) return { result: holdResult };
    }
    if (onX && "url" in scrolled && typeof scrolled.url === "string") {
      const holdResult = xHoldResult(store, scrolled.url);
      if (holdResult) return { result: holdResult };
    }
    return { result: scrolled.result };
  }

  if (name === "request_takeover") {
    const reason = asString(args, "reason") || "This step needs a human.";
    await setBrowserMode("human", reason);
    return pause(
      ctx,
      "request_takeover",
      { reason },
      "takeover",
      "The browser needs you",
      `${reason}\n\nOpen Computer → Browser. Finish only the blocked step. Then continue.`
    );
  }

  return { result: `Unknown tool ${name}` };
}

export async function executeApprovedCommand(command: string, bot: Bot, store: Store) {
  const ran = await runCommand(command);
  const output = [ran.stdout, ran.stderr].filter(Boolean).join("\n").trim() || "(no output)";
  store.terminalSessions.unshift({
    id: nid("term"),
    at: nowIso(),
    botId: bot.id,
    command,
    output: output.slice(0, 20_000),
    exitCode: ran.exitCode,
  });
  store.computerLogs.unshift({
    id: nid("log"),
    at: nowIso(),
    botId: bot.id,
    kind: "command",
    summary: `$ ${command}`,
    detail: output.slice(0, 2000),
  });
  return `exit ${ran.exitCode}\n${output.slice(0, 12_000)}`;
}

export async function executeApprovedAction(
  approval: PendingApproval,
  bot: Bot,
  store: Store,
  extendTimeout?: (ms: number) => void
) {
  if (approval.toolName === "run_command") {
    return executeApprovedCommand(String(approval.args.command || ""), bot, store);
  }
  if (approval.toolName === "browser_click") {
    const ref = typeof approval.args.ref === "number" ? approval.args.ref : undefined;
    let currentUrl: string | undefined;
    let currentGateNeeded = false;
    if (ref != null && Number.isFinite(ref)) {
      const snap = await browserSnapshot();
      if (snapshotLabel(snap.snapshot, ref) !== approval.args.label) return pageChangedResult;
      currentUrl = snap.url;
      currentGateNeeded = snap.gate.needed;
    } else {
      const snap = await browserSnapshot();
      currentUrl = snap.url;
      currentGateNeeded = snap.gate.needed;
    }
    const xRefusal = xBrowserRefusal(
      "browser_click",
      currentUrl ?? "",
      typeof approval.args.label === "string" ? approval.args.label : undefined
    );
    if (xRefusal) return xRefusal;
    const linkedIn = currentUrl != null && isLinkedInUrl(currentUrl);
    if (linkedIn) {
      const automaticHold = linkedInHoldResult(store, currentUrl!, currentGateNeeded);
      if (automaticHold) return automaticHold;
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return hold.message;
      const budget = linkedInPageDecision(store);
      if (budget.status === "refused") return budget.message;
    }
    const label = typeof approval.args.label === "string" ? approval.args.label : undefined;
    const isLinkedInSend =
      currentUrl != null &&
      isLinkedInUrl(currentUrl) &&
      isLinkedInSendAction({ kind: "click", label });
    const confirmation = isLinkedInSend
      && isInviteConfirmation(store, currentUrl!, label ?? null, new Date());
    if (isLinkedInSend) {
      const decision = confirmation ? linkedInSendWindow(store) : linkedInPacing(store);
      if (decision.status === "refused") {
        await deferSendingOutboxItem(store, decision.nextAllowedAt);
        return decision.message;
      }
    }
    const click = () => browserClick({
      ref: ref != null && Number.isFinite(ref) ? ref : undefined,
      x: typeof approval.args.x === "number" ? approval.args.x : undefined,
      y: typeof approval.args.y === "number" ? approval.args.y : undefined,
    });
    const clicked = linkedIn
      ? await runLinkedInAction(store.settings, click, extendTimeout)
      : await click();
    if (clicked.blocked) return clicked.result;
    const clickedUrl = "url" in clicked && typeof clicked.url === "string" ? clicked.url : undefined;
    if (linkedIn && clickedUrl && currentUrl && linkedInPathChanged(currentUrl, clickedUrl)) {
      recordLinkedInPageLoad(store.settings, new Date());
    }
    if (clickedUrl) {
      const holdResult = linkedInHoldResult(store, clickedUrl);
      if (holdResult) return holdResult;
    }
    if (isLinkedInSend && confirmation) {
      const refusal = await refuseInviteIfLimited(store, bot, currentUrl!);
      if (refusal) return refusal;
    }
    if (isLinkedInSend) {
      recordLinkedInAction(store);
      const entry = recordLinkedInSend(store, {
        botId: approval.botId,
        conversationId: approval.conversationId,
        messageId: approval.messageId,
        url: currentUrl,
        action: "click",
        label: label ?? null,
      });
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: bot.id,
        kind: "browser",
        summary: `LinkedIn ${entry.kind} recorded: ${entry.slug ?? entry.url}`,
      });
      if (entry.outboxItemId) {
        const { onOutboxItemSettled } = await import("@/lib/outbox-bot");
        onOutboxItemSettled(store, "sent");
        void measureOutboxAftermath(entry.outboxItemId).catch(() => {});
      }
    }
    store.computerLogs.unshift({
      id: nid("log"),
      at: nowIso(),
      botId: bot.id,
      kind: "browser",
      summary: "Approved browser click",
    });
    return clicked.result;
  }
  if (approval.toolName === "browser_press") {
    const snap = await browserSnapshot();
    const xRefusal = xBrowserRefusal("browser_press", snap.url);
    if (xRefusal) return xRefusal;
    const key = String(approval.args.key);
    const isLinkedInSend =
      isLinkedInUrl(snap?.url ?? "") && isLinkedInSendAction({ kind: "press", key });
    const confirmation = isLinkedInSend && isInviteConfirmation(
      store,
      snap.url,
      typeof approval.args.label === "string" ? approval.args.label : null,
      new Date()
    );
    if (isLinkedInUrl(snap?.url ?? "")) {
      const automaticHold = linkedInHoldResult(store, snap.url, snap.gate.needed);
      if (automaticHold) return automaticHold;
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return hold.message;
    }
    if (isLinkedInSend) {
      const decision = confirmation ? linkedInSendWindow(store) : linkedInPacing(store);
      if (decision.status === "refused") {
        await deferSendingOutboxItem(store, decision.nextAllowedAt);
        return decision.message;
      }
    }
    const press = () => browserPress(key);
    const pressed = isLinkedInUrl(snap?.url ?? "")
      ? await runLinkedInAction(store.settings, press, extendTimeout)
      : await press();
    if (pressed.blocked) return pressed.result;
    if (
      isLinkedInUrl(snap?.url ?? "") &&
      "url" in pressed &&
      typeof pressed.url === "string"
    ) {
      const holdResult = linkedInHoldResult(store, pressed.url);
      if (holdResult) return holdResult;
    }
    if (isLinkedInSend && confirmation) {
      const refusal = await refuseInviteIfLimited(store, bot, snap.url);
      if (refusal) return refusal;
    }
    if (isLinkedInSend) {
      recordLinkedInAction(store);
      const entry = recordLinkedInSend(store, {
        botId: approval.botId,
        conversationId: approval.conversationId,
        messageId: approval.messageId,
        url: snap.url,
        action: "press",
        key,
      });
      store.computerLogs.unshift({
        id: nid("log"),
        at: nowIso(),
        botId: bot.id,
        kind: "browser",
        summary: `LinkedIn ${entry.kind} recorded: ${entry.slug ?? entry.url}`,
      });
      if (entry.outboxItemId) {
        const { onOutboxItemSettled } = await import("@/lib/outbox-bot");
        onOutboxItemSettled(store, "sent");
        void measureOutboxAftermath(entry.outboxItemId).catch(() => {});
      }
    }
    return pressed.result;
  }
  if (approval.toolName === "browser_type") {
    const ref = typeof approval.args.ref === "number" ? approval.args.ref : undefined;
    let currentUrl: string | undefined;
    let currentGateNeeded = false;
    if (ref != null && Number.isFinite(ref)) {
      const snap = await browserSnapshot();
      if (snapshotLabel(snap.snapshot, ref) !== approval.args.label) return pageChangedResult;
      currentUrl = snap.url;
      currentGateNeeded = snap.gate.needed;
    } else {
      const snap = await browserSnapshot();
      currentUrl = snap.url;
      currentGateNeeded = snap.gate.needed;
    }
    const xRefusal = xBrowserRefusal("browser_type", currentUrl ?? "");
    if (xRefusal) return xRefusal;
    if (currentUrl && isLinkedInUrl(currentUrl)) {
      const automaticHold = linkedInHoldResult(store, currentUrl, currentGateNeeded);
      if (automaticHold) return automaticHold;
      const hold = checkLinkedInHold(store.settings);
      if (hold.status === "refused") return hold.message;
    }
    const text = String(approval.args.text);
    const isLinkedInSend =
      currentUrl != null &&
      isLinkedInUrl(currentUrl) &&
      isLinkedInSendAction({ kind: "type", text });
    if (isLinkedInSend) {
      const decision = linkedInPacing(store);
      if (decision.status === "refused") return decision.message;
    }
    const type = () => browserType(
      text,
      ref != null && Number.isFinite(ref) ? ref : undefined
    );
    const typed = currentUrl && isLinkedInUrl(currentUrl)
      ? await runLinkedInAction(store.settings, type, extendTimeout)
      : await type();
    if (typed.blocked) return typed.result;
    if (
      currentUrl &&
      isLinkedInUrl(currentUrl) &&
      "url" in typed &&
      typeof typed.url === "string"
    ) {
      const holdResult = linkedInHoldResult(store, typed.url);
      if (holdResult) return holdResult;
    }
    if (currentUrl && isLinkedInUrl(currentUrl)) {
      rememberTypedText(currentUrl, text);
    }
    return typed.result;
  }
  if (approval.toolName === "request_takeover") {
    await setBrowserMode("bot");
    const snap = await browserSnapshot();
    return `User finished the human step.\n${snap.snapshot}`;
  }
  return "Approved.";
}
