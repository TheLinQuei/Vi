/**
 * Optional Discord adapter hints (from Vigil): resolved member display names for mention IDs.
 */

export type DiscordResolvedMentionV1 = { userId: string; displayName: string };

export function parseDiscordResolvedMentions(context: unknown): DiscordResolvedMentionV1[] {
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  const c = context as Record<string, unknown>;
  const discord = c.discord;
  if (!discord || typeof discord !== "object" || Array.isArray(discord)) return [];
  const rm = (discord as Record<string, unknown>).resolvedMentions;
  if (!Array.isArray(rm)) return [];
  const out: DiscordResolvedMentionV1[] = [];
  for (const item of rm) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const userId = typeof o.userId === "string" ? o.userId.trim() : "";
    const displayName = typeof o.displayName === "string" ? o.displayName.trim() : "";
    if (userId && displayName) out.push({ userId, displayName });
    if (out.length >= 25) break;
  }
  return out;
}

/** Short system block so the model uses names instead of only "her/him" when mentions are numeric. */
export function buildDiscordMentionResolutionSystemMessage(mentions: DiscordResolvedMentionV1[]): string | null {
  if (mentions.length === 0) return null;
  const lines = mentions.map(
    (m) =>
      `${m.displayName} (Discord user id ${m.userId}; the user message may show this only as <@${m.userId}>)`,
  );
  return [
    "Discord: the user's message includes one or more member mentions. Use these display names when congratulating, thanking, or referring to them—do not reply with only \"her\", \"him\", or \"them\" when a resolved name is listed below.",
    ...lines.map((l) => `- ${l}`),
  ].join("\n");
}
