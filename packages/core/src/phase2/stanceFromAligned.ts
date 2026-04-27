import type {
  ViAlignedInterpretationV1,
  ViPersistedChronosSnapshotV1,
  ViRelationalStateV1,
  ViStanceDirectionV1,
  ViStanceJustificationSourceV1,
  ViStanceV1,
  ViTemporalInternalStateV1,
  ViUserIntentPrimaryV1,
} from "@vi/shared";

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function chronosStanceShaping(input: {
  temporal: ViTemporalInternalStateV1;
  persistedChronos: ViPersistedChronosSnapshotV1;
}): number {
  return clamp01(
    0.38 * input.temporal.gapNormalizedWeight +
      0.34 * input.persistedChronos.drift +
      0.22 * input.persistedChronos.perceivedWeight,
  );
}

/**
 * Phase 2 — stance is mandatory for evaluative mode (enforced by type + server invariants).
 */
export function deriveStanceV1(input: {
  userMessage: string;
  aligned: ViAlignedInterpretationV1;
  relational: ViRelationalStateV1;
  temporal: ViTemporalInternalStateV1;
  persistedChronos: ViPersistedChronosSnapshotV1;
  responseMode: "descriptive" | "evaluative";
  /** Intent Engine v1 primary (material stance shape vs plain evaluative asks). */
  userIntentPrimary: ViUserIntentPrimaryV1;
  hasRepoEvidence: boolean;
}): ViStanceV1 {
  if (input.responseMode === "descriptive") {
    return {
      version: 1,
      direction: "mixed",
      strength: 0.2,
      justificationSource: "uncertain",
    };
  }

  const neg = /\b(worse|bad idea|terrible|don't like|do not like|hate|awful|no thanks)\b/i.test(
    input.userMessage,
  );
  const chrono = chronosStanceShaping({
    temporal: input.temporal,
    persistedChronos: input.persistedChronos,
  });

  let direction: ViStanceDirectionV1 = "lean_positive";
  if (neg) direction = "lean_negative";
  else if (input.aligned.wantsIntent === "fit_eval") direction = "mixed";
  else if (input.aligned.intentType === "relational_check") direction = "lean_positive";
  else if (
    input.userIntentPrimary === "relational" ||
    input.userIntentPrimary === "repair" ||
    input.userIntentPrimary === "boundary_contract"
  ) {
    direction = "mixed";
  }

  let strength =
    0.42 +
    0.48 * input.aligned.significance * (0.65 + 0.35 * input.relational.trustWeight);
  strength *= 0.82 + 0.22 * input.relational.engagementTrend;
  strength *= 0.88 + 0.2 * input.relational.loyaltyAlignment;
  strength *= 1 - 0.35 * input.relational.relationalStrain;
  strength *= 0.88 + 0.2 * chrono;
  if (
    input.userIntentPrimary === "relational" ||
    input.userIntentPrimary === "repair" ||
    input.userIntentPrimary === "boundary_contract" ||
    input.userIntentPrimary === "continuity_check"
  ) {
    strength *= 0.78;
  }
  if (input.userIntentPrimary === "reflective") strength *= 0.9;
  strength = clamp01(strength);

  const justificationSource: ViStanceJustificationSourceV1 = input.hasRepoEvidence
    ? "evidence"
    : input.persistedChronos.drift > 0.12 || input.temporal.gapNormalizedWeight > 0.08
      ? "state"
      : "uncertain";

  return {
    version: 1,
    direction,
    strength,
    justificationSource,
  };
}
