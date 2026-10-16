"use client";

import type { ReactNode } from "react";

function inline(text: string) {
  const pieces: (string | { href: string; label: string } | { code: string } | { strong: string })[] = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) pieces.push(text.slice(last, m.index));
    if (m[2] && m[3]) pieces.push({ href: m[3], label: m[2] });
    else if (m[4]) pieces.push({ code: m[4] });
    else if (m[5]) pieces.push({ strong: m[5] });
    else pieces.push({ href: m[1] || m[0], label: m[1] || m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push(text.slice(last));
  return pieces.map((p, i) => {
    if (typeof p === "string") return <span key={i}>{p}</span>;
    if ("code" in p) {
      return (
        <code key={i} className="rounded bg-foreground/8 px-1 py-0.5 font-mono text-[0.85em]">
          {p.code}
        </code>
      );
    }
    if ("strong" in p) return <strong key={i}>{p.strong}</strong>;
    return (
      <a key={i} href={p.href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
        {p.label}
      </a>
    );
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n```/);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      const [lang, ...rest] = blocks[i].split("\n");
      const code = rest.join("\n").replace(/\n$/, "");
      nodes.push(
        <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed">
          {lang.trim() ? <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">{lang.trim()}</div> : null}
          <code>{code}</code>
        </pre>
      );
      continue;
    }
    const paras = blocks[i].split(/\n{2,}/);
    paras.forEach((para, j) => {
      const lines = para.split("\n");
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        nodes.push(
          <ul key={`${i}-${j}`} className="my-2 list-disc space-y-1 pl-5">
            {lines.map((l, k) => (
              <li key={k}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
            ))}
          </ul>
        );
        return;
      }
      if (lines[0]?.startsWith("# ")) {
        nodes.push(
          <h3 key={`${i}-${j}`} className="mt-3 mb-1 text-base font-semibold">
            {inline(lines[0].replace(/^#\s+/, ""))}
          </h3>
        );
        if (lines.length > 1) {
          nodes.push(
            <p key={`${i}-${j}-b`} className="whitespace-pre-wrap leading-relaxed">
              {inline(lines.slice(1).join("\n"))}
            </p>
          );
        }
        return;
      }
      if (para.trim()) {
        nodes.push(
          <p key={`${i}-${j}`} className="whitespace-pre-wrap leading-relaxed">
            {inline(para)}
          </p>
        );
      }
    });
  }
  return <div className="space-y-1 text-[15px]">{nodes}</div>;
}
