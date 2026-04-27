import type { ViRelationalStateV1, ViUserIntentPrimaryV1 } from "@vi/shared";

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

export const DEFAULT_RELATIONAL_STATE_V1: ViRelationalStateV1 = {
  version: 1,
  familiarity: 0,
  trustWeight: 0.5,
  engagementTrend: 0.5,
  loyaltyAlignment: 0.7,
  relationalStrain: 0.1,
};

export function parseRelationalStateJson(json: string | null | undefined): ViRelationalStateV1 {
  if (!json?.trim()) return { ...DEFAULT_RELATIONAL_STATE_V1 };
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== "object") return { ...DEFAULT_RELATIONAL_STATE_V1 };
    return {
      version: 1,
      familiarity: clamp01(Number(o.familiarity ?? DEFAULT_RELATIONAL_STATE_V1.familiarity)),
      trustWeight: clamp01(Number(o.trustWeight ?? DEFAULT_RELATIONAL_STATE_V1.trustWeight)),
      engagementTrend: clamp01(
        Number(o.engagementTrend ?? DEFAULT_RELATIONAL_STATE_V1.engagementTrend),
      ),
      loyaltyAlignment: clamp01(
        Number(o.loyaltyAlignment ?? DEFAULT_RELATIONAL_STATE_V1.loyaltyAlignment),
      ),
      relationalStrain: clamp01(
        Number(o.relationalStrain ?? DEFAULT_RELATIONAL_STATE_V1.relationalStrain),
      ),
    };
  } catch {
    return { ...DEFAULT_RELATIONAL_STATE_V1 };
  }
}

export function serializeRelationalStateV1(r: ViRelationalStateV1): string {
  return JSON.stringify({
    familiarity: r.familiarity,
    trustWeight: r.trustWeight,
    engagementTrend: r.engagementTrend,
    loyaltyAlignment: r.loyaltyAlignment,
    relationalStrain: r.relationalStrain,
  });
}

function disrespectSignal(message: string | undefined): number {
  const m = (message ?? "").toLowerCase();
  if (!m) return 0;
  if (/\b(stfu|shut up|you are useless|hate you|idiot|moron|dumb)\b/i.test(m)) return 1;
  if (/\b(stop talking|annoying|worthless|stupid)\b/i.test(m)) return 0.7;
  return 0;
}

/** After a completed turn — history nudges relationship scalars (deterministic). */
export function computeNextRelationalStateV1(input: {
  prior: ViRelationalStateV1;
  userMessage?: string;
  userMessageLength: number;
  assistantReplyLength: number;
  gapMsSinceLastInteraction: number;
  responseMode: "descriptive" | "evaluative";
  /** Intent Engine v1 — weights trust/familiarity deltas by ask-shape. */
  userIntentPrimary?: ViUserIntentPrimaryV1;
  /** Reserved for future secure override integration. */
  overrideForced?: boolean;
  turnClass: "presence_cue" | "substantive" | "neutral";
}): ViRelationalStateV1 {
  const primary = input.userIntentPrimary ?? "informational";

  let familiarity = input.prior.familiarity;
  if (input.turnClass === "substantive" && input.userMessageLength > 24) familiarity += 0.04;
  if (input.turnClass === "presence_cue") familiarity += 0.015;
  if (input.responseMode === "evaluative") familiarity += 0.02;
  if (primary === "relational") familiarity += 0.028;
  if (primary === "repair") familiarity += 0.022;
  familiarity = clamp01(familiarity);

  let trustWeight = input.prior.trustWeight;
  if (input.responseMode === "evaluative" && input.userMessageLength > 12) trustWeight += 0.025;
  if (input.assistantReplyLength > 40) trustWeight += 0.01;
  if (primary === "repair") trustWeight += 0.034;
  if (primary === "relational") trustWeight += 0.018;
  if (primary === "boundary_contract") trustWeight = clamp01(trustWeight - 0.014);
  trustWeight = clamp01(trustWeight);

  let engagementTrend = input.prior.engagementTrend;
  const longGap = input.gapMsSinceLastInteraction > 40 * 60 * 1000;
  if (longGap) engagementTrend *= 0.88;
  else engagementTrend = clamp01(engagementTrend + 0.03);
  engagementTrend = clamp01(engagementTrend);

  const disrespect = disrespectSignal(input.userMessage);

  let relationalStrain = input.prior.relationalStrain;
  const gapDays = Math.min(1, input.gapMsSinceLastInteraction / (24 * 60 * 60 * 1000));
  relationalStrain -= 0.08 * gapDays;
  relationalStrain += 0.18 * disrespect;
  if (input.overrideForced) relationalStrain += 0.28;
  if (primary === "repair" && disrespect === 0) relationalStrain -= 0.06;
  if (input.turnClass === "substantive" && disrespect === 0 && !input.overrideForced) relationalStrain -= 0.02;
  relationalStrain = clamp01(relationalStrain);

  let loyaltyAlignment = input.prior.loyaltyAlignment;
  loyaltyAlignment += 0.03 * (primary === "relational" ? 1 : 0);
  loyaltyAlignment += 0.05 * (primary === "repair" ? 1 : 0);
  loyaltyAlignment -= 0.16 * disrespect;
  if (input.overrideForced) loyaltyAlignment -= 0.22;
  loyaltyAlignment -= 0.12 * relationalStrain;
  loyaltyAlignment = clamp01(loyaltyAlignment);

  return { version: 1, familiarity, trustWeight, engagementTrend, loyaltyAlignment, relationalStrain };
}
