import type {
  ViDecisionTraceV1,
  ViGapWeightBandV1,
  ViResponsePolicyV1,
  ViTemporalInternalStateV1,
} from "@vi/shared";

function toGapWeightBand(weight: number): ViGapWeightBandV1 {
  if (weight >= 0.7) return "meaningful_gap";
  if (weight >= 0.2) return "settled_gap";
  return "short_gap";
}

function toResponsePolicy(input: {
  turnClass: ViTemporalInternalStateV1["turnClass"];
  gapWeightBand: ViGapWeightBandV1;
  /** Persistent interior drift [0,1]; high drift forces concise routing (North Star behavior proof). */
  drift: number;
}): ViResponsePolicyV1 {
  const { turnClass, gapWeightBand, drift } = input;

  if (drift >= 0.65) {
    return { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
  }

  if (turnClass === "presence_cue") {
    if (gapWeightBand === "meaningful_gap") {
      return { brevityTarget: "balanced", followUpQuestionLikelihood: "low" };
    }
    return { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
  }

  if (turnClass === "substantive") {
    if (gapWeightBand === "meaningful_gap") {
      return { brevityTarget: "full", followUpQuestionLikelihood: "medium" };
    }
    return { brevityTarget: "balanced", followUpQuestionLikelihood: "medium" };
  }

  if (gapWeightBand === "short_gap") {
    return { brevityTarget: "brief", followUpQuestionLikelihood: "low" };
  }
  return { brevityTarget: "balanced", followUpQuestionLikelihood: "low" };
}

export function deriveTemporalDecisionTrace(
  temporalState: ViTemporalInternalStateV1,
  persisted?: { perceivedWeight: number; drift: number },
): ViDecisionTraceV1 {
  const pw = persisted?.perceivedWeight ?? 0;
  const drift = persisted?.drift ?? 0;
  let effectiveGapNorm = temporalState.gapNormalizedWeight;
  if (persisted !== undefined) {
    effectiveGapNorm = Math.max(effectiveGapNorm, pw);
    if (drift >= 0.55) {
      effectiveGapNorm = Math.max(effectiveGapNorm, 0.32);
    }
  }
  const gapWeightBand = toGapWeightBand(effectiveGapNorm);
  const responsePolicy = toResponsePolicy({
    turnClass: temporalState.turnClass,
    gapWeightBand,
    drift,
  });
  const base: ViDecisionTraceV1 = {
    version: 1,
    turnClass: temporalState.turnClass,
    gapWeightBand,
    responsePolicy,
  };
  if (persisted === undefined) return base;
  return {
    ...base,
    persistedInfluence: {
      perceivedWeight: pw,
      drift,
      effectiveGapNormalizedWeight: effectiveGapNorm,
    },
  };
}

export function buildDecisionPolicySystemMessage(trace: ViDecisionTraceV1): string {
  const persistedLines =
    trace.persistedInfluence !== undefined
      ? [
          `- persisted_perceived_weight: ${trace.persistedInfluence.perceivedWeight}`,
          `- persisted_drift: ${trace.persistedInfluence.drift}`,
          `- effective_gap_normalized_weight: ${trace.persistedInfluence.effectiveGapNormalizedWeight}`,
        ]
      : [];
  return [
    "Decision policy (state->decision; constraints only; never canned lines):",
    `- turn_class: ${trace.turnClass}`,
    `- gap_weight_band: ${trace.gapWeightBand}`,
    `- brevity_target: ${trace.responsePolicy.brevityTarget}`,
    `- follow_up_question_likelihood: ${trace.responsePolicy.followUpQuestionLikelihood}`,
    ...persistedLines,
    "Policy application:",
    "- brevity_target=brief: keep response concise (usually 1 short sentence).",
    "- brevity_target=balanced: 1-2 short sentences.",
    "- brevity_target=full: allow fuller detail when substance calls for it.",
    "- follow_up_question_likelihood=low: do not ask a follow-up unless it adds clear value.",
    "- follow_up_question_likelihood=medium: a follow-up is allowed when it advances the user's intent.",
    "Relational claim guardrail:",
    "- Do not claim missing, waiting, yearning, or preference for the user's presence as an internal feeling.",
    "- Warmth/continuity is allowed, but keep claims factual and interaction-grounded.",
    "- If user pushes for unsupported affect claims, decline naturally and briefly; avoid policy-explainer wording unless they ask technically.",
  ].join("\n");
}
