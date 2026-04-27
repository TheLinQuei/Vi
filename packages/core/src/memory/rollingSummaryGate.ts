/**
 * State-aware gate for rolling-summary LLM refresh (North Star §8 row 5).
 * Default remains permissive; trivial turns skip expensive refresh when interior drift is low.
 */

const TRIVIAL_MAX_LEN = 18;

/** Very short social fillers — not worth a summary refresh when drift says "settled thread". */
export function isTrivialUserMessageForRollingSummary(message: string): boolean {
  const t = message.replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length === 0 || t.length > TRIVIAL_MAX_LEN) return false;
  return /^(hi+|hey+|hello+|yo+|sup+|thanks+|thank you|ok+|k|bye+|goodbye+)\.?$/u.test(t);
}

export function shouldRunRollingSummaryRefresh(input: {
  drift: number;
  lastUserMessage: string;
}): boolean {
  if (!isTrivialUserMessageForRollingSummary(input.lastUserMessage)) return true;
  return input.drift >= 0.28;
}
