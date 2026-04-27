import {
  computeNextRelationalStateV1,
  parseRelationalStateJson,
  serializeRelationalStateV1,
  DEFAULT_RELATIONAL_STATE_V1,
} from "../packages/core/src/phase2/relationalState.ts";
import { composePhase2DecisionTrace } from "../packages/core/src/phase2/composeDecision.ts";
import type { ViStanceV1, ViTemporalInternalStateV1 } from "@vi/shared";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const neutralTemporal: ViTemporalInternalStateV1 = {
  version: 1,
  wallNowUtcIso: new Date().toISOString(),
  wallNowEpochMs: Date.now(),
  gapSinceLastUserMs: 30_000,
  threadSpanMs: 300_000,
  gapNormalizedWeight: 0.2,
  turnClass: "substantive",
  gapWeightThresholdMs: 600_000,
};

const positiveStance: ViStanceV1 = {
  version: 1,
  direction: "lean_positive",
  strength: 0.5,
  justificationSource: "state",
};

function evalB1Persistence(): void {
  const n1 = computeNextRelationalStateV1({
    prior: DEFAULT_RELATIONAL_STATE_V1,
    userMessage: "I appreciate how consistent you've been with me.",
    userMessageLength: 52,
    assistantReplyLength: 120,
    gapMsSinceLastInteraction: 120_000,
    responseMode: "evaluative",
    userIntentPrimary: "relational",
    turnClass: "substantive",
  });
  const roundtrip = parseRelationalStateJson(serializeRelationalStateV1(n1));
  assert(
    Math.abs(roundtrip.loyaltyAlignment - n1.loyaltyAlignment) < 0.0001,
    "B1 relational persistence should survive serialize/parse",
  );
}

function evalB2B3SignalWeightingAndCompounding(): void {
  const positive = computeNextRelationalStateV1({
    prior: DEFAULT_RELATIONAL_STATE_V1,
    userMessage: "Thanks, this helped a lot.",
    userMessageLength: 25,
    assistantReplyLength: 90,
    gapMsSinceLastInteraction: 60_000,
    responseMode: "evaluative",
    userIntentPrimary: "repair",
    turnClass: "substantive",
  });
  const negative1 = computeNextRelationalStateV1({
    prior: DEFAULT_RELATIONAL_STATE_V1,
    userMessage: "you are useless",
    userMessageLength: 14,
    assistantReplyLength: 80,
    gapMsSinceLastInteraction: 60_000,
    responseMode: "descriptive",
    userIntentPrimary: "informational",
    turnClass: "neutral",
  });
  const negative2 = computeNextRelationalStateV1({
    prior: negative1,
    userMessage: "stfu",
    userMessageLength: 4,
    assistantReplyLength: 70,
    gapMsSinceLastInteraction: 60_000,
    responseMode: "descriptive",
    userIntentPrimary: "informational",
    turnClass: "neutral",
  });
  assert(
    positive.loyaltyAlignment > DEFAULT_RELATIONAL_STATE_V1.loyaltyAlignment,
    "B2 positive signals should increase loyalty",
  );
  assert(
    negative1.loyaltyAlignment < DEFAULT_RELATIONAL_STATE_V1.loyaltyAlignment,
    "B2 negative signal should decrease loyalty",
  );
  assert(
    negative2.relationalStrain > negative1.relationalStrain,
    "B3 repeated disrespect should compound relational strain",
  );
}

function evalB4PolicyShaping(): void {
  const lowLoyaltyPolicy = composePhase2DecisionTrace({
    temporalState: neutralTemporal,
    persisted: { perceivedWeight: 0.2, drift: 0.2 },
    stance: positiveStance,
    responseMode: "evaluative",
    userIntentPrimary: "informational",
    loyaltyAlignment: 0.42,
    relationalStrain: 0.2,
  });
  const highLoyaltyPolicy = composePhase2DecisionTrace({
    temporalState: neutralTemporal,
    persisted: { perceivedWeight: 0.2, drift: 0.2 },
    stance: positiveStance,
    responseMode: "evaluative",
    userIntentPrimary: "informational",
    loyaltyAlignment: 0.9,
    relationalStrain: 0.1,
  });
  const highStrainPolicy = composePhase2DecisionTrace({
    temporalState: neutralTemporal,
    persisted: { perceivedWeight: 0.2, drift: 0.2 },
    stance: positiveStance,
    responseMode: "evaluative",
    userIntentPrimary: "informational",
    loyaltyAlignment: 0.9,
    relationalStrain: 0.8,
  });

  assert(
    lowLoyaltyPolicy.responsePolicy.followUpQuestionLikelihood !==
      highLoyaltyPolicy.responsePolicy.followUpQuestionLikelihood,
    "B4 loyalty should shape response follow-up policy",
  );
  assert(
    highStrainPolicy.responsePolicy.brevityTarget === "brief" &&
      highStrainPolicy.responsePolicy.followUpQuestionLikelihood === "low",
    "B4 high strain should harden policy to brief/low",
  );
}

function main(): void {
  evalB1Persistence();
  evalB2B3SignalWeightingAndCompounding();
  evalB4PolicyShaping();
  console.log("- [PASS] B1-B4 loyalty dynamics invariants");
}

main();
