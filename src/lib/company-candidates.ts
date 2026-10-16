import { nid, nowIso } from "@/lib/ids";
import type {
  CompanyCandidate,
  CompanyCriterionAnswer,
  Store,
} from "@/lib/types";

export function normalizeCompanyDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  let host: string;
  if (/^https?:\/\//.test(value)) {
    try {
      host = new URL(value).hostname;
    } catch {
      return null;
    }
  } else {
    host = value.split(/[/?#]/, 1)[0].replace(/:\d+$/, "");
  }

  host = host.replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

function isLinkedInHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.+$/, "");
  return normalized === "linkedin.com" || normalized.endsWith(".linkedin.com");
}

interface RecordCompanyCandidateInput {
  domain: unknown;
  name?: unknown;
  lane: unknown;
  verdict: unknown;
  criteria: unknown;
  createdBy: string;
}

export function recordCompanyCandidate(
  store: Store,
  input: RecordCompanyCandidateInput
): CompanyCandidate {
  const domain = normalizeCompanyDomain(input.domain);
  if (!domain) throw new Error("Refused: company domain is invalid.");
  if (isLinkedInHost(domain)) {
    throw new Error("Refused: LinkedIn cannot be used as the company domain.");
  }
  if (input.lane !== "A" && input.lane !== "B") {
    throw new Error("Refused: lane must be A or B.");
  }
  if (input.verdict !== "yes" && input.verdict !== "no" && input.verdict !== "unsure") {
    throw new Error("Refused: verdict must be yes, no or unsure.");
  }
  if (!Array.isArray(input.criteria) || input.criteria.length < 1 || input.criteria.length > 12) {
    throw new Error("Refused: criteria must contain 1 to 12 items.");
  }

  const criteria: CompanyCriterionAnswer[] = input.criteria.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Refused: criterion ${index + 1} is invalid.`);
    }
    const item = raw as Record<string, unknown>;
    const criterion = typeof item.criterion === "string" ? item.criterion.trim() : "";
    if (!criterion) throw new Error(`Refused: criterion ${index + 1} is empty.`);
    if (item.answer !== "yes" && item.answer !== "no" && item.answer !== "unknown") {
      throw new Error(`Refused: criterion ${index + 1} has an invalid answer.`);
    }
    if (item.answer === "unknown") return { criterion, answer: item.answer };

    const url = typeof item.url === "string" ? item.url.trim() : "";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Refused: criterion ${index + 1} requires an http or https URL.`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Refused: criterion ${index + 1} requires an http or https URL.`);
    }
    if (isLinkedInHost(parsedUrl.hostname.toLowerCase())) {
      throw new Error(`Refused: criterion ${index + 1} cannot use LinkedIn evidence.`);
    }
    const quote = typeof item.quote === "string" ? item.quote.trim() : "";
    if (!quote) throw new Error(`Refused: criterion ${index + 1} requires a quote.`);
    if (quote.length > 300) {
      throw new Error(`Refused: criterion ${index + 1} quote exceeds 300 characters.`);
    }
    return { criterion, answer: item.answer, url, quote };
  });

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const existing = (store.companyCandidates ?? []).find(
    (item) => normalizeCompanyDomain(item.domain) === domain && item.lane === input.lane
  );
  if (existing && (existing.verdict === "yes" || existing.verdict === "no")) {
    throw new Error(
      `Refused: ${domain} is already settled as ${existing.verdict} for lane ${input.lane} (${existing.id}). Do not research it further.`
    );
  }
  if (existing) {
    if (name) existing.name = name;
    else delete existing.name;
    existing.verdict = input.verdict;
    existing.criteria = criteria;
    existing.updatedAt = nowIso();
    existing.botId = input.createdBy;
    return existing;
  }

  const item: CompanyCandidate = {
    id: nid("company"),
    at: nowIso(),
    botId: input.createdBy,
    domain,
    ...(name ? { name } : {}),
    lane: input.lane,
    verdict: input.verdict,
    criteria,
  };
  (store.companyCandidates ??= []).push(item);
  return item;
}

export function formatCompanyCandidate(item: CompanyCandidate): string {
  const first = `${item.id} ${item.domain}${item.name ? ` [${item.name}]` : ""} lane ${item.lane} ${item.verdict}`;
  const criteria = item.criteria.map((answer) => {
    const evidence =
      answer.answer === "unknown" ? "" : ` (${answer.url}) \"${answer.quote}\"`;
    return `  - ${answer.criterion}: ${answer.answer}${evidence}`;
  });
  return [first, ...criteria].join("\n");
}
