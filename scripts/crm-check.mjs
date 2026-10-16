import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_DATABASE_ID = "set-CREW_NOTION_CRM_DATABASE_ID";
const ACCEPTED_STATUSES = ["connected", "accepted", "awaiting DM", "messaged", "follow-up due"];
const UNSENT_STATUSES = ["queued", "held", "blocked"];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

export function parseInvitations(text) {
  const [headers = [], ...rows] = parseCsv(text);
  return rows
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((invitation) => invitation.Direction === "OUTGOING");
}

export function parseSentPage(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line !== "");
  const names = [];
  for (let index = 2; index < lines.length - 1; index += 1) {
    if (lines[index].startsWith("Sent ") && lines[index + 1] === "Withdraw") {
      names.push(lines[index - 2]);
    }
  }
  return names;
}

export function linkedinSlug(value) {
  if (!value) return null;
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("in");
    if (marker < 0 || !parts[marker + 1]) return null;
    return decodeURIComponent(parts[marker + 1]).toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeName(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(",", 1)[0]
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase();
}

export function matchSentNames(sentNames, invitations) {
  const outgoing = invitations.filter((invitation) => invitation.Direction === "OUTGOING");
  const matches = [];
  const unmatched = [];
  for (const sentName of sentNames) {
    const normalized = normalizeName(sentName);
    const invitation = outgoing.find((candidate) => normalizeName(candidate.To) === normalized);
    if (invitation) matches.push({ sentName, invitation });
    else unmatched.push(sentName);
  }
  return { matches, unmatched };
}

export function parseNotionRow(page) {
  const properties = page.properties ?? {};
  return {
    pageId: page.id,
    name: properties.Name?.title?.map((part) => part.plain_text ?? "").join("") ?? "",
    status: properties.Status?.select?.name ?? null,
    linkedin: properties.LinkedIn?.url ?? null,
    crmId: properties["CRM ID"]?.number ?? null,
  };
}

export async function fetchAllNotionRows({ token, databaseId, fetchFn }) {
  const rows = [];
  let cursor;
  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const response = await fetchFn(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        "Notion-Version": "2022-06-28",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Notion query failed with status ${response.status}`);
    const page = await response.json();
    rows.push(...(page.results ?? []).map(parseNotionRow));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return rows;
}

export function expectedStatuses(slug, sentSlugSet, exportSlugSet) {
  if (sentSlugSet.has(slug)) return ["pending"];
  if (exportSlugSet.has(slug)) return [...ACCEPTED_STATUSES];
  return [...UNSENT_STATUSES];
}

function evidenceReason(expected) {
  if (expected.length === 1) return "on the Sent page";
  if (expected === ACCEPTED_STATUSES || expected.includes("connected")) {
    return "in the export but not on the Sent page";
  }
  return "not sent";
}

export function computeResults(notionRows, invitations, sentNames) {
  const outgoing = invitations.filter((invitation) => invitation.Direction === "OUTGOING");
  const exportEntries = outgoing
    .map((invitation) => ({ invitation, slug: linkedinSlug(invitation.inviteeProfileUrl) }))
    .filter((entry) => entry.slug);
  const exportSlugSet = new Set(exportEntries.map((entry) => entry.slug));
  const sentMatches = matchSentNames(sentNames, outgoing);
  const sentSlugSet = new Set(
    sentMatches.matches.map(({ invitation }) => linkedinSlug(invitation.inviteeProfileUrl)).filter(Boolean)
  );
  const notionSlugSet = new Set();
  const mismatches = [];
  const notCheckable = [];

  for (const row of notionRows) {
    const slug = linkedinSlug(row.linkedin);
    if (!slug) {
      notCheckable.push(row);
      continue;
    }
    notionSlugSet.add(slug);
    const expected = expectedStatuses(slug, sentSlugSet, exportSlugSet);
    if (!expected.includes(row.status)) {
      mismatches.push({ ...row, slug, expected, reason: evidenceReason(expected) });
    }
  }

  const missingRows = exportEntries
    .filter(({ slug }) => !notionSlugSet.has(slug))
    .map(({ invitation, slug }) => ({ invitation, slug }));
  return {
    mismatches,
    missingRows,
    unmatchedSentNames: sentMatches.unmatched,
    notCheckable,
  };
}

function display(value) {
  return value === null || value === undefined || value === "" ? "(none)" : String(value);
}

export function formatReport(results) {
  const lines = results.mismatches.map(
    (row) =>
      `CRM ${display(row.crmId)} ${display(row.name)}: Status ${display(row.status)}, evidence says ${row.expected.join(", ")} (${row.reason})`
  );
  lines.push("Missing rows:");
  lines.push(...results.missingRows.map(({ invitation, slug }) => `${display(invitation.To)} (${slug})`));
  lines.push("Unmatched sent names:");
  lines.push(...results.unmatchedSentNames);
  lines.push("Not checkable:");
  lines.push(...results.notCheckable.map((row) => `CRM ${display(row.crmId)} ${display(row.name)}`));
  lines.push(
    `Summary: ${results.mismatches.length} mismatches, ${results.missingRows.length} missing rows, ${results.unmatchedSentNames.length} unmatched sent names, ${results.notCheckable.length} not checkable`
  );
  const failures = results.mismatches.length + results.missingRows.length + results.unmatchedSentNames.length;
  return { text: `${lines.join("\n")}\n`, exitCode: failures > 0 ? 1 : 0 };
}

export function resolveNotionToken(env, readFile = fs.readFileSync) {
  if (env.CREW_NOTION_TOKEN) return env.CREW_NOTION_TOKEN.trim();
  if (env.CREW_NOTION_TOKEN_FILE) return readFile(env.CREW_NOTION_TOKEN_FILE, "utf8").trim();
  return null;
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main({ argv, env, fetchFn, readFile }) {
  let token;
  try {
    token = resolveNotionToken(env, readFile);
  } catch {
    return { exitCode: 2, output: "CRM check failed: unable to read CREW_NOTION_TOKEN_FILE.\n" };
  }
  if (!token) {
    return {
      exitCode: 2,
      output: "Set CREW_NOTION_TOKEN or CREW_NOTION_TOKEN_FILE to read the Notion CRM.\n",
    };
  }
  const invitationsPath = argumentValue(argv, "--invitations");
  const sentPath = argumentValue(argv, "--sent");
  if (!invitationsPath || !sentPath) {
    return { exitCode: 2, output: "Usage: crm:check -- --invitations <path> --sent <path>\n" };
  }

  try {
    const invitations = parseInvitations(readFile(invitationsPath, "utf8"));
    const sentNames = parseSentPage(readFile(sentPath, "utf8"));
    const notionRows = await fetchAllNotionRows({
      token,
      databaseId: env.CREW_NOTION_CRM_DATABASE_ID || DEFAULT_DATABASE_ID,
      fetchFn,
    });
    const report = formatReport(computeResults(notionRows, invitations, sentNames));
    return { exitCode: report.exitCode, output: report.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const safeMessage = token ? message.split(token).join("[redacted]") : message;
    return { exitCode: 2, output: `CRM check failed: ${safeMessage}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main({
    argv: process.argv.slice(2),
    env: process.env,
    fetchFn: fetch,
    readFile: fs.readFileSync,
  });
  const destination = result.exitCode === 2 ? process.stderr : process.stdout;
  destination.write(result.output);
  process.exitCode = result.exitCode;
}
