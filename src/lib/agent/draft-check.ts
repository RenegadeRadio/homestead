export const DEFAULT_BANNED_PHRASES = [
  "i hope this finds you well",
  "i hope this message finds you well",
  "i hope you are doing well",
  "delve",
  "in today's fast-paced",
  "game-changer",
  "game changer",
  "unlock the potential",
  "revolutionize",
  "cutting-edge",
  "i came across your profile",
  "touch base",
];

export const DEFAULT_STANDING_RULES =
  "Client-facing text (drafts, and anything typed into the shared browser) never contains an em dash or an en dash. It never uses stock AI phrasing. Every draft names something specific to that person or organisation, taken from their own profile or site, and says what we offer in plain words.";

function normalize(text: string) {
  return text.toLowerCase().replaceAll("\u2019", "'").replace(/\s+/g, " ");
}

export function findDraftProblems(text: string, bannedPhrases: string[]) {
  const problems: string[] = [];
  if (text.includes("\u2014")) problems.push("contains an em dash (U+2014)");
  if (text.includes("\u2013")) problems.push("contains an en dash (U+2013)");

  const normalizedText = normalize(text);
  for (const phrase of bannedPhrases) {
    if (normalizedText.includes(normalize(phrase))) {
      problems.push(`contains the phrase "${phrase}"`);
    }
  }
  return problems;
}

export function draftCheckRefusal(problems: string[]) {
  return `Draft check failed: ${problems.join("; ")}. Rewrite the text without them and try again.`;
}
