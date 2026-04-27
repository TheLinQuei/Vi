export type MixedEnvironmentContextV1 = {
  channelType?: "direct" | "group";
  participants?: string[];
  speakerName?: string;
  addresseeHint?: string;
};

export function parseMixedEnvironmentContext(context: unknown): MixedEnvironmentContextV1 {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const c = context as Record<string, unknown>;
  const participants = Array.isArray(c.participants)
    ? c.participants.filter((p): p is string => typeof p === "string").slice(0, 20)
    : undefined;
  const channelType =
    c.channelType === "group" || c.channelType === "direct"
      ? c.channelType
      : participants && participants.length > 2
        ? "group"
        : undefined;
  return {
    channelType,
    participants,
    speakerName: typeof c.speakerName === "string" ? c.speakerName : undefined,
    addresseeHint: typeof c.addresseeHint === "string" ? c.addresseeHint : undefined,
  };
}

export function inferAddressedToVi(input: {
  message: string;
  context: MixedEnvironmentContextV1;
  viName?: string;
}): boolean {
  const viName = (input.viName ?? "vi").toLowerCase();
  const message = input.message.trim();
  const m = message.toLowerCase();
  const isGroup = input.context.channelType === "group" || (input.context.participants?.length ?? 0) > 2;
  if (!isGroup) return true;

  const hint = input.context.addresseeHint?.trim().toLowerCase();
  if (hint) return hint === viName || hint === "assistant";

  if (new RegExp(`\\b${viName}\\b`, "i").test(message)) return true;

  const directedPrefix = message.match(/^(@?[a-zA-Z][a-zA-Z0-9_-]{1,24})[:,]\s*/);
  if (directedPrefix) {
    const target = directedPrefix[1].replace(/^@/, "").toLowerCase();
    if (target !== viName && target !== "assistant") return false;
  }

  if (/^(hey|yo|hi|hello)\s+@?[a-z]/i.test(message)) {
    const target = message
      .replace(/^(hey|yo|hi|hello)\s+/i, "")
      .split(/[,\s!?]/)[0]
      ?.replace(/^@/, "")
      .toLowerCase();
    if (target && target !== viName && target !== "assistant") return false;
  }

  // In ambiguous mixed context, if it's a question with second-person language, default to addressed.
  if (/\?$/.test(message) && /\b(you|your|can you|would you|do you)\b/i.test(m)) return true;

  return false;
}
