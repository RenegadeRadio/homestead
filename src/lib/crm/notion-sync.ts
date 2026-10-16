import fs from "node:fs";

import { isConnectClickLabel, linkedInProfileSlug } from "@/lib/agent/linkedin-send-log";
import { getStore, updateStore } from "@/lib/store";
import type {
  CrmProspectEntry,
  CrmSyncResult,
  CrmSyncState,
  LinkedInSendEntry,
} from "@/lib/types";

export const DEFAULT_DATABASE_ID = "set-CREW_NOTION_CRM_DATABASE_ID";

type Environment = Record<string, string | undefined>;
type FetchFn = typeof fetch;
type ReadFile = (path: string, encoding: "utf8") => string;

export interface NotionRow {
  pageId: string;
  status: string | null;
  linkedin: string | null;
}

export interface SyncDependencies {
  fetchFn: FetchFn;
  env: Environment;
  readFile?: ReadFile;
  rows?: NotionRow[];
}

export type CrmSyncCounts = Record<CrmSyncState, number>;

export function resolveNotionToken(
  env: Environment,
  readFile: ReadFile = fs.readFileSync
): string | null {
  if (env.CREW_NOTION_TOKEN) return env.CREW_NOTION_TOKEN.trim();
  if (env.CREW_NOTION_TOKEN_FILE) {
    return readFile(env.CREW_NOTION_TOKEN_FILE, "utf8").trim();
  }
  return null;
}

export function redactToken(message: string, token: string | null): string {
  return token ? message.split(token).join("[redacted]") : message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function notionRequest(
  url: string,
  init: { method: string; body?: unknown },
  token: string,
  fetchFn: FetchFn
): Promise<unknown> {
  try {
    const response = await fetchFn(url, {
      method: init.method,
      headers: {
        "Notion-Version": "2022-06-28",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!response.ok) {
      throw new Error(`Notion request failed with status ${response.status}`);
    }
    return response.json();
  } catch (error) {
    throw new Error(redactToken(errorMessage(error), token));
  }
}

export async function fetchCrmRows({
  token,
  databaseId,
  fetchFn,
}: {
  token: string;
  databaseId: string;
  fetchFn: FetchFn;
}): Promise<NotionRow[]> {
  const rows: NotionRow[] = [];
  let cursor: string | null = null;
  do {
    const page = (await notionRequest(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      { method: "POST", body: cursor ? { start_cursor: cursor } : {} },
      token,
      fetchFn
    )) as {
      results?: Array<{
        id: string;
        properties?: {
          Status?: { select?: { name?: string } | null };
          LinkedIn?: { url?: string | null };
        };
      }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    rows.push(
      ...(page.results ?? []).map((result) => ({
        pageId: result.id,
        status: result.properties?.Status?.select?.name ?? null,
        linkedin: result.properties?.LinkedIn?.url ?? null,
      }))
    );
    cursor = page.has_more ? (page.next_cursor ?? null) : null;
  } while (cursor);
  return rows;
}

async function listChildBlockTexts(
  pageId: string,
  token: string,
  fetchFn: FetchFn
): Promise<string[]> {
  const texts: string[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : "";
    const page = (await notionRequest(
      `https://api.notion.com/v1/blocks/${pageId}/children${query}`,
      { method: "GET" },
      token,
      fetchFn
    )) as {
      results?: Array<Record<string, unknown> & { type?: string }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    for (const block of page.results ?? []) {
      const value = block.type ? block[block.type] : undefined;
      const richText =
        value && typeof value === "object" && "rich_text" in value
          ? (value.rich_text as Array<{ plain_text?: string; text?: { content?: string } }> | undefined)
          : undefined;
      texts.push(
        (richText ?? []).map((part) => part.plain_text ?? part.text?.content ?? "").join("")
      );
    }
    cursor = page.has_more ? (page.next_cursor ?? null) : null;
  } while (cursor);
  return texts;
}

function buildNoteText(entry: LinkedInSendEntry): string {
  const subject = entry.label ?? entry.key ?? entry.action;
  const text = entry.text === null ? "Text: none" : `Text: "${entry.text}"`;
  return `Homestead recorded ${entry.kind} at ${entry.at} (send ${entry.id}): ${subject}. ${text}`;
}

function buildProspectNoteText(entry: CrmProspectEntry): string {
  const base = `PROSPECT RECORDED, NOT CONTACTED: ${entry.note}`;
  return entry.salesNavUrl ? `${base}\nSales Nav: ${entry.salesNavUrl}` : base;
}

async function appendParagraph(
  pageId: string,
  text: string,
  token: string,
  fetchFn: FetchFn
): Promise<void> {
  await notionRequest(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      method: "PATCH",
      body: {
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: text } }],
            },
          },
        ],
      },
    },
    token,
    fetchFn
  );
}

async function applyStatusAndNote(
  row: NotionRow,
  entry: LinkedInSendEntry,
  token: string,
  fetchFn: FetchFn
): Promise<string> {
  let newStatus: string | undefined;
  if (entry.kind === "invite" && (row.status === "queued" || row.status === "held")) {
    newStatus = "pending";
  } else if (
    entry.kind === "message" &&
    ["pending", "connected", "accepted", "awaiting DM", "follow-up due"].includes(row.status ?? "")
  ) {
    newStatus = "messaged";
  }

  const properties: Record<string, unknown> = {};
  if (newStatus) properties.Status = { select: { name: newStatus } };
  if (entry.kind === "invite" || entry.kind === "message") {
    const content =
      entry.text ??
      `${entry.kind === "invite" ? "Invite" : "Message"} sent ${entry.at.slice(0, 10)}; Homestead recorded no text.`;
    properties["Latest note"] = {
      rich_text: [{ type: "text", text: { content } }],
    };
  }
  if (Object.keys(properties).length > 0) {
    await notionRequest(
      `https://api.notion.com/v1/pages/${row.pageId}`,
      { method: "PATCH", body: { properties } },
      token,
      fetchFn
    );
  }
  return newStatus
    ? `Status set to ${newStatus}`
    : `Status left as ${row.status ?? "(none)"}`;
}

export async function syncSendEntry(
  entry: LinkedInSendEntry,
  deps: SyncDependencies,
  options: { name?: string } = {}
): Promise<CrmSyncResult> {
  let token: string | null = null;
  try {
    if (entry.kind === "invite" && isConnectClickLabel(entry.label)) {
      return { state: "skipped", detail: "Connect click; the invite is recorded at Send." };
    }
    token = resolveNotionToken(deps.env, deps.readFile);
    if (!token) return { state: "not-configured", detail: "" };
    if (!entry.slug) return { state: "skipped", detail: "" };

    const databaseId = deps.env.CREW_NOTION_CRM_DATABASE_ID || DEFAULT_DATABASE_ID;
    const rows =
      deps.rows ??
      (await fetchCrmRows({
        token,
        databaseId,
        fetchFn: deps.fetchFn,
      }));
    const matches = rows.filter(
      (row) => row.linkedin && linkedInProfileSlug(row.linkedin) === entry.slug
    );
    if (matches.length === 0) {
      const hasOutreachLane = entry.lane === "A" || entry.lane === "B";
      const isOutreachSend = entry.kind === "message" || entry.kind === "invite";
      if (!hasOutreachLane || !isOutreachSend) {
        return { state: "no-row", detail: "" };
      }

      const status = entry.kind === "invite" ? "pending" : "messaged";
      const linkedin = `https://www.linkedin.com/in/${entry.slug}/`;
      const created = (await notionRequest(
        "https://api.notion.com/v1/pages",
        {
          method: "POST",
          body: {
            parent: { database_id: databaseId },
            properties: {
              Name: {
                title: [
                  { type: "text", text: { content: options.name ?? entry.slug } },
                ],
              },
              LinkedIn: { url: linkedin },
              Lane: { select: { name: entry.lane } },
              Status: { select: { name: status } },
              Source: { select: { name: "linkedin" } },
            },
          },
        },
        token,
        deps.fetchFn
      )) as { id: string };
      rows.push({ pageId: created.id, status, linkedin });
      await appendParagraph(created.id, buildNoteText(entry), token, deps.fetchFn);
      return { state: "synced", detail: "row created" };
    }
    if (matches.length > 1) return { state: "ambiguous", detail: "" };

    const row = matches[0];
    const childTexts = await listChildBlockTexts(row.pageId, token, deps.fetchFn);
    if (childTexts.some((text) => text.includes(entry.id))) {
      return { state: "synced", detail: "already recorded" };
    }
    const detail = await applyStatusAndNote(row, entry, token, deps.fetchFn);
    await appendParagraph(row.pageId, buildNoteText(entry), token, deps.fetchFn);
    return { state: "synced", detail };
  } catch (error) {
    return { state: "failed", detail: redactToken(errorMessage(error), token) };
  }
}

export async function syncProspectEntry(
  entry: CrmProspectEntry,
  deps: SyncDependencies
): Promise<CrmSyncResult> {
  let token: string | null = null;
  try {
    token = resolveNotionToken(deps.env, deps.readFile);
    if (!token) return { state: "not-configured", detail: "" };
    if (!entry.slug) return { state: "skipped", detail: "no profile slug" };

    const databaseId = deps.env.CREW_NOTION_CRM_DATABASE_ID || DEFAULT_DATABASE_ID;
    const rows =
      deps.rows ??
      (await fetchCrmRows({ token, databaseId, fetchFn: deps.fetchFn }));
    const matches = rows.filter(
      (row) => row.linkedin && linkedInProfileSlug(row.linkedin) === entry.slug
    );
    if (matches.length > 1) return { state: "ambiguous", detail: "" };
    if (matches.length === 1) {
      return { state: "skipped", detail: "row already exists" };
    }

    const linkedin = `https://www.linkedin.com/in/${entry.slug}/`;
    const created = (await notionRequest(
      "https://api.notion.com/v1/pages",
      {
        method: "POST",
        body: {
          parent: { database_id: databaseId },
          properties: {
            Name: { title: [{ type: "text", text: { content: entry.name } }] },
            LinkedIn: { url: linkedin },
            Lane: { select: { name: entry.lane } },
            Status: { select: { name: entry.status } },
            Source: { select: { name: entry.source } },
            ...(entry.country
              ? {
                  Country: {
                    rich_text: [{ type: "text", text: { content: entry.country } }],
                  },
                }
              : {}),
            ...(entry.company ? { Company: { rich_text: [{ type: "text", text: { content: entry.company } }] } } : {}),
            ...(entry.role ? { Title: { rich_text: [{ type: "text", text: { content: entry.role } }] } } : {}),
            ...(entry.headcount ? { Headcount: { select: { name: entry.headcount } } } : {}),
            ...(entry.industry ? { Industry: { rich_text: [{ type: "text", text: { content: entry.industry } }] } } : {}),
            ...(entry.outOfTarget ? { "Out of target": { rich_text: [{ type: "text", text: { content: entry.outOfTarget } }] } } : {}),
          },
        },
      },
      token,
      deps.fetchFn
    )) as { id: string };
    rows.push({ pageId: created.id, status: entry.status, linkedin });
    await appendParagraph(created.id, buildProspectNoteText(entry), token, deps.fetchFn);
    return { state: "synced", detail: "row created" };
  } catch (error) {
    return { state: "failed", detail: redactToken(errorMessage(error), token) };
  }
}

export async function syncProspectAcceptance(
  entry: CrmProspectEntry,
  deps: SyncDependencies
): Promise<CrmSyncResult> {
  let token: string | null = null;
  try {
    token = resolveNotionToken(deps.env, deps.readFile);
    if (!token) return { state: "not-configured", detail: "" };
    if (!entry.slug) return { state: "skipped", detail: "no profile slug" };

    const databaseId = deps.env.CREW_NOTION_CRM_DATABASE_ID || DEFAULT_DATABASE_ID;
    const rows =
      deps.rows ??
      (await fetchCrmRows({ token, databaseId, fetchFn: deps.fetchFn }));
    const matches = rows.filter(
      (row) => row.linkedin && linkedInProfileSlug(row.linkedin) === entry.slug
    );
    if (matches.length === 0) return { state: "no-row", detail: "" };
    if (matches.length > 1) return { state: "ambiguous", detail: "" };

    await notionRequest(
      `https://api.notion.com/v1/pages/${matches[0].pageId}`,
      {
        method: "PATCH",
        body: { properties: { Status: { select: { name: "accepted" } } } },
      },
      token,
      deps.fetchFn
    );
    return { state: "synced", detail: "Status set to accepted" };
  } catch (error) {
    return { state: "failed", detail: redactToken(errorMessage(error), token) };
  }
}

function emptyCounts(): CrmSyncCounts {
  return {
    "not-configured": 0,
    skipped: 0,
    "no-row": 0,
    ambiguous: 0,
    synced: 0,
    failed: 0,
  };
}

let syncChain: Promise<unknown> = Promise.resolve();
let prospectSyncChain: Promise<unknown> = Promise.resolve();

async function runSync(deps: SyncDependencies): Promise<CrmSyncCounts> {
  const counts = emptyCounts();
  try {
    const store = await getStore();
    const outboxById = new Map((store.outbox ?? []).map((item) => [item.id, item]));
    const pending = (store.linkedinSendLog ?? []).filter(
      (entry) =>
        !entry.crmSync ||
        ["failed", "not-configured", "no-row"].includes(entry.crmSync.state)
    );
    const token = resolveNotionToken(deps.env, deps.readFile);
    let rows: NotionRow[] | undefined;
    let rowsError: string | undefined;
    if (token && pending.some((entry) => entry.slug)) {
      try {
        rows = await fetchCrmRows({
          token,
          databaseId: deps.env.CREW_NOTION_CRM_DATABASE_ID || DEFAULT_DATABASE_ID,
          fetchFn: deps.fetchFn,
        });
      } catch (error) {
        rowsError = redactToken(errorMessage(error), token);
      }
    }
    const completed: Array<{ id: string; result: CrmSyncResult }> = [];
    for (const entry of pending) {
      if (rowsError && entry.slug) {
        completed.push({
          id: entry.id,
          result: { state: "failed", detail: rowsError },
        });
        continue;
      }
      try {
        completed.push({
          id: entry.id,
          result: await syncSendEntry(
            entry,
            { ...deps, rows },
            {
              name: entry.outboxItemId
                ? outboxById.get(entry.outboxItemId)?.name
                : undefined,
            }
          ),
        });
      } catch {
        completed.push({
          id: entry.id,
          result: {
            state: "failed" as const,
            detail: "Unexpected error.",
          },
        });
      }
    }
    for (const { result } of completed) counts[result.state] += 1;
    if (completed.length > 0) {
      const completedById = new Map(completed.map((item) => [item.id, item.result]));
      const at = new Date().toISOString();
      await updateStore((current) => {
        for (const entry of current.linkedinSendLog ?? []) {
          const result = completedById.get(entry.id);
          if (result) entry.crmSync = { ...result, at };
        }
      });
    }
    return counts;
  } catch {
    counts.failed += 1;
    return counts;
  }
}

export function syncPendingSends(deps: SyncDependencies): Promise<CrmSyncCounts> {
  const run = syncChain.then(() => runSync(deps));
  syncChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function runProspectSync(deps: SyncDependencies): Promise<CrmSyncCounts> {
  const counts = emptyCounts();
  try {
    const store = await getStore();
    const pending = (store.crmProspects ?? []).filter((entry) => !entry.syncedAt);
    const token = resolveNotionToken(deps.env, deps.readFile);
    let rows: NotionRow[] | undefined;
    let rowsError: string | undefined;
    if (token && pending.some((entry) => entry.slug)) {
      try {
        rows = await fetchCrmRows({
          token,
          databaseId: deps.env.CREW_NOTION_CRM_DATABASE_ID || DEFAULT_DATABASE_ID,
          fetchFn: deps.fetchFn,
        });
      } catch (error) {
        rowsError = redactToken(errorMessage(error), token);
      }
    }

    const completed: Array<{ id: string; result: CrmSyncResult }> = [];
    for (const entry of pending) {
      if (rowsError && entry.slug) {
        completed.push({ id: entry.id, result: { state: "failed", detail: rowsError } });
        continue;
      }
      try {
        completed.push({
          id: entry.id,
          result: await syncProspectEntry(entry, { ...deps, rows }),
        });
      } catch {
        completed.push({
          id: entry.id,
          result: { state: "failed", detail: "Unexpected error." },
        });
      }
    }
    for (const { result } of completed) counts[result.state] += 1;
    if (completed.length > 0) {
      const completedById = new Map(completed.map((item) => [item.id, item.result]));
      const at = new Date().toISOString();
      await updateStore((current) => {
        for (const entry of current.crmProspects ?? []) {
          const result = completedById.get(entry.id);
          if (
            result?.state === "synced" ||
            (result?.state === "skipped" && result.detail === "row already exists")
          ) {
            entry.syncedAt = at;
          }
        }
      });
    }
    return counts;
  } catch {
    counts.failed += 1;
    return counts;
  }
}

export function syncProspects(deps: SyncDependencies): Promise<CrmSyncCounts> {
  const run = prospectSyncChain.then(() => runProspectSync(deps));
  prospectSyncChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
