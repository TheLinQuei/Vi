/**
 * Token budget helpers — ported in spirit from legacy `packages/prompts/src/composer.ts`
 * (estimateTokensRough + tiered caps). Used to trim low-priority Vi system blocks under pressure.
 */

export type PromptVerbosity = "compact" | "medium" | "verbose";

/** Rough token estimate (~4 chars per token), matching legacy composer. */
export function estimateTokensRough(text: string): number {
  return Math.ceil(text.length / 4);
}

export const SYSTEM_MESSAGE_TOKEN_BUDGET: Record<PromptVerbosity, number> = {
  compact: 150,
  medium: 250,
  verbose: 350,
};

export function parsePromptVerbosity(raw: string | undefined): PromptVerbosity | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "compact" || v === "medium" || v === "verbose") return v;
  return null;
}

export function resolveSystemMessageTokenBudget(): number {
  const tier = parsePromptVerbosity(process.env.VI_SYSTEM_PROMPT_BUDGET);
  if (!tier) return Number.POSITIVE_INFINITY;
  return SYSTEM_MESSAGE_TOKEN_BUDGET[tier];
}

export type BudgetedSystemBlock = {
  role: "system";
  content: string;
  /** Lower = dropped first when over budget. */
  budgetPriority: number;
};

/**
 * Drops whole system blocks starting from lowest `budgetPriority` until estimated
 * tokens are at or under `maxTokens`, or only one block remains.
 */
export function applySystemMessageTokenBudget(
  blocks: BudgetedSystemBlock[],
  maxTokens: number,
): Array<{ role: "system"; content: string }> {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return blocks.map(({ role, content }) => ({ role, content }));
  }

  let work = [...blocks];
  const totalOf = (arr: BudgetedSystemBlock[]) =>
    arr.reduce((s, b) => s + estimateTokensRough(b.content), 0);

  let total = totalOf(work);
  while (total > maxTokens && work.length > 1) {
    let dropIdx = 0;
    for (let i = 1; i < work.length; i += 1) {
      if (work[i].budgetPriority < work[dropIdx].budgetPriority) dropIdx = i;
    }
    total -= estimateTokensRough(work[dropIdx].content);
    work = work.filter((_, i) => i !== dropIdx);
  }

  return work.map(({ role, content }) => ({ role, content }));
}
