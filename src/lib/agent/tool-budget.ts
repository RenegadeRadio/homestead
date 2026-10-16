export const DEFAULT_TOOL_BUDGET_PER_TURN = 40;

export function toolBudgetText(budget: number) {
  return `Tool budget reached (${budget} calls this turn). Stop now and report what you have so far, including what is unfinished.`;
}
