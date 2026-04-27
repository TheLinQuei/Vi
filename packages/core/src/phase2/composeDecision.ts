import { deriveTemporalDecisionTrace } from "../decision/temporalDecisionPolicy.js";
import type {
  ViDecisionTraceV1,
  ViEmotionalPostureV1,
  ViResponsePolicyV1,
  ViStanceV1,
  ViTemporalInternalStateV1,
  ViUserIntentPrimaryV1,
} from "@vi/shared";

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function intentExpressionOverlay(primary: ViUserIntentPrimaryV1): Partial<ViResponsePolicyV1> | null {
  switch (primary) {
    case "boundary_contract":
      return { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
    case "repair":
      return { brevityTarget: "balanced", followUpQuestionLikelihood: "medium" };
    case "relational":
      return { brevityTarget: "balanced", followUpQuestionLikelihood: "medium" };
    case "continuity_check":
      return { brevityTarget: "balanced", followUpQuestionLikelihood: "medium" };
    case "reflective":
      return { brevityTarget: "balanced", followUpQuestionLikelihood: "low" };
    case "directive":
      return { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
    default:
      return null;
  }
}

export function deriveEmotionalPostureV1(input: {
  userIntentPrimary: ViUserIntentPrimaryV1;
  loyaltyAlignment?: number;
  relationalStrain?: number;
  stanceDirection?: ViStanceV1["direction"];
}): ViEmotionalPostureV1 {
  const primary = input.userIntentPrimary;
  const loyalty = clamp01(input.loyaltyAlignment ?? 0.7);
  const strain = clamp01(input.relationalStrain ?? 0.1);
  if (strain >= 0.62) return "strained";
  if (primary === "boundary_contract") return "firm";
  if (primary === "repair") return "protective";
  if (primary === "relational" && loyalty >= 0.74) return "warm";
  if (input.stanceDirection === "lean_negative") return "firm";
  return "steady";
}

/**
 * Temporal banding first, then Phase 2 stance + Chronos engagement on top.
 */
export function composePhase2DecisionTrace(input: {
  temporalState: ViTemporalInternalStateV1;
  persisted?: { perceivedWeight: number; drift: number };
  stance: ViStanceV1;
  responseMode: "descriptive" | "evaluative";
  /** Intent Engine v1 — expression policy overlay (relational/repair/boundary vs plain evaluative). */
  userIntentPrimary?: ViUserIntentPrimaryV1;
  /** Loyalty dynamics shape expression policy (v1 contract B4). */
  loyaltyAlignment?: number;
  relationalStrain?: number;
}): ViDecisionTraceV1 {
  const base = deriveTemporalDecisionTrace(input.temporalState, input.persisted);
  const primary = input.userIntentPrimary ?? "informational";
  const overlay = intentExpressionOverlay(primary);

  const mergeOverlay = (trace: ViDecisionTraceV1): ViDecisionTraceV1 => {
    if (!overlay) return trace;
    return {
      ...trace,
      responsePolicy: { ...trace.responsePolicy, ...overlay },
    };
  };

  if (input.responseMode !== "evaluative") return mergeOverlay(base);

  const chronosEngagementShaping = clamp01(
    0.35 * input.temporalState.gapNormalizedWeight + 0.45 * (input.persisted?.drift ?? 0),
  );

  let responsePolicy = { ...base.responsePolicy };
  const driftLockedBrief = (input.persisted?.drift ?? 0) >= 0.65;
  const loyaltyAlignment = clamp01(input.loyaltyAlignment ?? 0.7);
  const relationalStrain = clamp01(input.relationalStrain ?? 0.1);
  const emotionalPosture = deriveEmotionalPostureV1({
    userIntentPrimary: primary,
    loyaltyAlignment,
    relationalStrain,
    stanceDirection: input.stance.direction,
  });

  if (input.stance.direction === "lean_negative") {
    responsePolicy = { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
  } else if (input.stance.direction === "lean_positive") {
    const follow: "low" | "medium" =
      chronosEngagementShaping > 0.52 || input.stance.strength > 0.62 ? "medium" : "low";
    if (!driftLockedBrief && input.stance.strength > 0.52 && responsePolicy.brevityTarget === "brief") {
      responsePolicy = { brevityTarget: "balanced", followUpQuestionLikelihood: follow };
    } else {
      responsePolicy = { ...responsePolicy, followUpQuestionLikelihood: follow };
    }
  } else {
    responsePolicy = {
      brevityTarget: chronosEngagementShaping > 0.62 ? "balanced" : responsePolicy.brevityTarget,
      followUpQuestionLikelihood:
        chronosEngagementShaping > 0.58 ? "medium" : responsePolicy.followUpQuestionLikelihood,
    };
  }

  // Loyalty/strain overlay after stance routing:
  // high strain -> shorter, less probing; high loyalty -> allows medium follow-up.
  if (relationalStrain >= 0.62) {
    responsePolicy = { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
  } else if (loyaltyAlignment >= 0.76 && responsePolicy.followUpQuestionLikelihood === "low") {
    responsePolicy = { ...responsePolicy, followUpQuestionLikelihood: "medium" };
  }

  const phase2 = {
    stanceDirection: input.stance.direction,
    stanceStrength: input.stance.strength,
    chronosEngagementShaping,
    emotionalPosture,
  };

  return mergeOverlay({
    ...base,
    responsePolicy,
    phase2,
  });
}
