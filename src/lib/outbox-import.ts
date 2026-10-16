export interface ParsedDraft {
  name: string;
  text: string;
  note?: string;
  lane?: "A" | "B";
}

export interface RefusedHeading {
  name: string;
  reason: string;
}

export function parsePlaybookDrafts(markdown: string): {
  drafts: ParsedDraft[];
  refused: RefusedHeading[];
} {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => {
    const match = /^### (.*)$/.exec(line);
    return match ? [{ index, text: match[1] }] : [];
  });
  const drafts: ParsedDraft[] = [];
  const refused: RefusedHeading[] = [];

  headings.forEach((heading, headingIndex) => {
    const separator = heading.text.indexOf("·");
    const name = (separator === -1 ? heading.text : heading.text.slice(0, separator)).trim();
    const markersText = separator === -1 ? "" : heading.text.slice(separator + 1);
    const markers = markersText.split("·").map((marker) => marker.trim().toLowerCase());

    if (markersText.includes("⛔") || /do not send/i.test(markersText)) {
      refused.push({ name, reason: "Marked do not send." });
      return;
    }

    const end = headings[headingIndex + 1]?.index ?? lines.length;
    const body = lines.slice(heading.index + 1, end);
    const quoteStart = body.findIndex((line) => line.trimStart().startsWith(">"));
    if (quoteStart === -1) {
      refused.push({ name, reason: "No draft text found below the heading." });
      return;
    }

    const note = body.slice(0, quoteStart).join("\n").trim() || undefined;
    const quoteLines: string[] = [];
    for (let index = quoteStart; index < body.length; index += 1) {
      const line = body[index].trimStart();
      if (!line.startsWith(">")) break;
      quoteLines.push(line.replace(/^> ?/, ""));
    }

    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const line of quoteLines) {
      if (line.length === 0) {
        if (current.length > 0) paragraphs.push(current.join(" "));
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) paragraphs.push(current.join(" "));

    const lane = markers.includes("lane a") ? "A" : markers.includes("lane b") ? "B" : undefined;
    drafts.push({ name, text: paragraphs.join("\n\n"), ...(note ? { note } : {}), ...(lane ? { lane } : {}) });
  });

  return { drafts, refused };
}
