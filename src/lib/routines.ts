import { CronExpressionParser } from "cron-parser";

import { handleUserMessage } from "@/lib/agent/run";
import { nowIso } from "@/lib/ids";
import { getStore, updateStore } from "@/lib/store";

export function nextRun(cron: string, timezone: string) {
  const expr = CronExpressionParser.parse(cron, {
    currentDate: new Date(),
    tz: timezone || "UTC",
  });
  const next = expr.next();
  return next.toISOString() || next.toDate().toISOString();
}

declare global {
  var __crewRoutineTimer: ReturnType<typeof setInterval> | undefined;
}

const running = new Set<string>();

export function startRoutineTicker() {
  if (globalThis.__crewRoutineTimer) return;
  globalThis.__crewRoutineTimer = setInterval(() => {
    void tickRoutines();
  }, 20_000);
}

export async function tickRoutines() {
  const store = await getStore();
  const due = store.routines.filter(
    (r) => r.enabled && r.nextRunAt && Date.parse(r.nextRunAt) <= Date.now()
  );
  for (const routine of due) {
    if (running.has(routine.id)) continue;
    running.add(routine.id);
    try {
      const advanced = await updateStore((s) => {
        const r = s.routines.find((x) => x.id === routine.id);
        if (!r) return false;
        r.lastRunAt = nowIso();
        try {
          r.nextRunAt = nextRun(r.cron, r.timezone);
          return true;
        } catch {
          r.enabled = false;
          return false;
        }
      });
      if (!advanced) continue;

      const skill = routine.skillId ? store.skills.find((s) => s.id === routine.skillId) : undefined;
      const text = [
        `[Routine: ${routine.name}]`,
        routine.prompt,
        skill ? `Follow skill /${skill.slug}.` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await handleUserMessage({
        conversationId: routine.conversationId,
        text,
        skillId: routine.skillId,
        emit: () => undefined,
      });
    } catch (err) {
      console.error("Routine failed", routine.id, err);
    } finally {
      running.delete(routine.id);
    }
  }
}
