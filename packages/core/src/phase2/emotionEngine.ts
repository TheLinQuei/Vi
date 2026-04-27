import type { ViEmotionalStateV1, ViPrimaryEmotionV1, ViStanceDirectionV1, ViUserIntentPrimaryV1 } from "@vi/shared";

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

const POSITIVITY_ORDER: ViPrimaryEmotionV1[] = [
  "calm",
  "joy",
  "gratitude",
  "affection",
  "pride",
  "curiosity",
  "surprise",
  "sadness",
  "fear",
  "anger",
];
const TIE_EPSILON = 0.01;

function topEmotion(core: Record<ViPrimaryEmotionV1, number>): ViPrimaryEmotionV1 {
  let winner: ViPrimaryEmotionV1 = "calm";
  let best = -1;
  for (const [k, v] of Object.entries(core) as Array<[ViPrimaryEmotionV1, number]>) {
    if (v > best + TIE_EPSILON) {
      best = v;
      winner = k;
    } else if (Math.abs(v - best) <= TIE_EPSILON) {
      const currentRank = POSITIVITY_ORDER.indexOf(winner);
      const newRank = POSITIVITY_ORDER.indexOf(k);
      if (newRank < currentRank) winner = k;
    }
  }
  return winner;
}

export function deriveEmotionalStateV1(input: {
  userIntentPrimary: ViUserIntentPrimaryV1;
  loyaltyAlignment?: number;
  relationalStrain?: number;
  stanceDirection?: ViStanceDirectionV1;
  wantsIntent?: "none" | "preference_choice" | "improvement_eval" | "fit_eval" | "depth_eval";
  gapMs?: number;
}): ViEmotionalStateV1 {
  const loyalty = clamp01(input.loyaltyAlignment ?? 0.7);
  const strain = clamp01(input.relationalStrain ?? 0.1);
  const intent = input.userIntentPrimary;
  const stance = input.stanceDirection ?? "mixed";

  const core: Record<ViPrimaryEmotionV1, number> = {
    joy: 0.18 + 0.22 * loyalty - 0.18 * strain,
    sadness: 0.08 + 0.36 * strain + (intent === "repair" ? 0.12 : 0),
    anger:
      0.05 +
      0.32 * strain +
      (intent === "boundary_contract" ? 0.2 : 0) +
      (stance === "lean_negative" &&
      (intent === "boundary_contract" || intent === "repair" || intent === "relational")
        ? 0.08
        : 0),
    fear: Math.min(0.22, 0.04 + 0.22 * strain + (intent === "continuity_check" ? 0.1 : 0)),
    surprise:
      0.06 +
      (intent === "reflective" && input.wantsIntent !== "depth_eval" ? 0.2 : 0) +
      (intent === "relational" && stance === "lean_positive" ? 0.18 : 0),
    affection: 0.1 + 0.48 * loyalty - 0.2 * strain + (intent === "relational" ? 0.16 : 0),
    curiosity:
      0.16 +
      (intent === "reflective" ? 0.24 : 0) +
      (input.wantsIntent === "depth_eval" ? 0.24 : 0) -
      0.08 * strain,
    calm: Math.max(0.06, 0.32 + 0.18 * loyalty - 0.32 * strain),
    pride:
      0.1 +
      0.28 * loyalty +
      (intent === "directive" || input.wantsIntent === "improvement_eval" ? 0.28 : 0),
    gratitude: 0.14 + 0.36 * loyalty - 0.16 * strain + (intent === "repair" ? 0.14 : 0),
  };

  for (const key of Object.keys(core) as ViPrimaryEmotionV1[]) {
    core[key] = clamp01(core[key]);
  }
  if (typeof input.gapMs === "number" && input.gapMs > 4 * 60 * 60 * 1000) {
    const decayFactor = Math.min(0.14, (input.gapMs / (24 * 60 * 60 * 1000)) * 0.14);
    core.anger = Math.max(0.05, core.anger - decayFactor * 0.7);
    core.fear = Math.max(0.04, core.fear - decayFactor * 0.55);
    core.sadness = Math.max(0.08, core.sadness - decayFactor * 0.4);
  }

  const primary = topEmotion(core);
  return {
    version: 1,
    primary,
    primaryIntensity: core[primary],
    core,
  };
}

