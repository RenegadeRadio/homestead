import { DEFAULT_BANNED_PHRASES, draftCheckRefusal, findDraftProblems } from "@/lib/agent/draft-check";
import { nid, nowIso } from "@/lib/ids";
import type { Store, XReply } from "@/lib/types";

export function xStatusUrlId(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }
    return /^\/[A-Za-z0-9_]+\/status\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createXReply(
  store: Store,
  input: Pick<XReply, "postUrl" | "author" | "postExcerpt" | "text" | "note" | "postAt" | "createdBy">
): XReply {
  const postUrl = input.postUrl.trim();
  const author = input.author.trim();
  const text = input.text;
  const statusId = xStatusUrlId(postUrl);
  if (!statusId) throw new Error("Refused: postUrl must be an X status URL like https://x.com/<handle>/status/<digits>.");
  if (!author || !text.trim()) throw new Error("Refused: author and text must not be empty.");
  if (text.length > 280) throw new Error("Refused: X replies must be 280 characters or fewer.");
  const problems = findDraftProblems(
    text,
    store.settings.draftBannedPhrases ?? DEFAULT_BANNED_PHRASES
  );
  if (problems.length) throw new Error(draftCheckRefusal(problems));
  if (input.postExcerpt.length > 500) throw new Error("Refused: postExcerpt must be 500 characters or fewer.");
  if (
    input.postAt !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}T/.test(input.postAt) || Number.isNaN(new Date(input.postAt).getTime()))
  ) {
    throw new Error("Refused: postAt must be an ISO 8601 date and time, read from the post's timestamp.");
  }
  if ((store.xReplies ?? []).some((item) => xStatusUrlId(item.postUrl) === statusId)) {
    throw new Error("Refused: an X reply for this post already exists.");
  }
  const item: XReply = {
    id: nid("xreply"),
    postUrl,
    author,
    postExcerpt: input.postExcerpt,
    text,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.postAt !== undefined ? { postAt: input.postAt } : {}),
    status: "draft",
    createdAt: nowIso(),
    createdBy: input.createdBy,
  };
  (store.xReplies ??= []).push(item);
  return item;
}

export function markXReplyPosted(store: Store, input: { id: string }): XReply {
  const item = store.xReplies?.find((candidate) => candidate.id === input.id);
  if (!item) throw new Error("X reply not found.");
  item.status = "posted";
  item.postedAt = nowIso();
  return item;
}

export function dropXReply(store: Store, input: { id: string }): XReply {
  const item = store.xReplies?.find((candidate) => candidate.id === input.id);
  if (!item) throw new Error("X reply not found.");
  item.status = "dropped";
  return item;
}
