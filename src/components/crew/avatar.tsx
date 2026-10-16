"use client";

import { cn } from "cn";
import type { Bot } from "@/lib/types";

export function BotAvatar({ bot, size = "md" }: { bot: Bot; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "size-7 text-sm" : size === "lg" ? "size-11 text-xl" : "size-9 text-base";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-white/10 font-medium",
        dim
      )}
      style={{ background: `${bot.color}22`, color: bot.color }}
    >
      <span aria-hidden>{bot.emoji}</span>
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
