import { computeNextRelationalStateV1, DEFAULT_RELATIONAL_STATE_V1 } from "../packages/core/src/phase2/relationalState";
import { deriveEmotionalStateV1 } from "../packages/core/src/phase2/emotionEngine";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runSupportiveSequence(): void {
  let state = { ...DEFAULT_RELATIONAL_STATE_V1 };
  for (let i = 0; i < 12; i += 1) {
    const prior = state;
    const emotion = deriveEmotionalStateV1({
      userIntentPrimary: "relational",
      loyaltyAlignment: prior.loyaltyAlignment,
      relationalStrain: prior.relationalStrain,
      stanceDirection: "lean_positive",
      wantsIntent: "none",
      gapMs: 60_000,
    });
    assert(
      emotion.primary !== "anger",
      "supportive relational sequence must not drift to anger as primary",
    );
    state = computeNextRelationalStateV1({
      prior,
      userMessage: "Thanks for staying steady with me and helping me think this through.",
      userMessageLength: 74,
      assistantReplyLength: 120,
      gapMsSinceLastInteraction: 60_000,
      responseMode: "descriptive",
      userIntentPrimary: "relational",
      turnClass: "substantive",
    });
  }
  assert(state.loyaltyAlignment > 0.78, "supportive sequence should increase loyalty alignment");
  assert(state.relationalStrain < 0.08, "supportive sequence should reduce relational strain");
}

function runRepairAfterStrainSequence(): void {
  let state = { ...DEFAULT_RELATIONAL_STATE_V1, loyaltyAlignment: 0.45, relationalStrain: 0.65 };
  for (let i = 0; i < 10; i += 1) {
    const prior = state;
    const emotion = deriveEmotionalStateV1({
      userIntentPrimary: "repair",
      loyaltyAlignment: prior.loyaltyAlignment,
      relationalStrain: prior.relationalStrain,
      stanceDirection: "mixed",
      wantsIntent: "none",
      gapMs: 120_000,
    });
    assert(emotion.core.anger < 0.35, "repair sequence should keep anger bounded");
    state = computeNextRelationalStateV1({
      prior,
      userMessage: "You're right, I handled that badly. Let's reset and do this properly.",
      userMessageLength: 66,
      assistantReplyLength: 130,
      gapMsSinceLastInteraction: 120_000,
      responseMode: "evaluative",
      userIntentPrimary: "repair",
      turnClass: "substantive",
    });
  }
  assert(state.loyaltyAlignment > 0.6, "repair sequence should recover loyalty alignment");
  assert(state.relationalStrain < 0.3, "repair sequence should materially lower strain");
}

function main(): void {
  runSupportiveSequence();
  runRepairAfterStrainSequence();
  console.log("- [PASS] memory-affection continuity long-run invariants");
}

main();
