import type {
  ViAlignedInterpretationV1,
  ViRelationalStateV1,
  ViStanceV1,
  ViUserIntentEngineV1,
} from "@vi/shared";

export function buildUserIntentSystemMessage(input: {
  userIntent: ViUserIntentEngineV1;
  effectiveResponseMode: "descriptive" | "evaluative";
}): string {
  const { userIntent, effectiveResponseMode } = input;
  const lines = [
    "User intent (Intent Engine v1; classify the *kind* of ask before interpretation):",
    `- primary: ${userIntent.primary}`,
    `- confidence: ${userIntent.confidence.toFixed(3)}`,
    `- effective_response_mode: ${effectiveResponseMode}`,
    `- rationale_tags: ${userIntent.rationaleTags.join(", ") || "(none)"}`,
    "Rules:",
    "- Let `primary` steer reply shape: informational answers; evaluative takes a side; relational tends to the connection without inventing private feelings.",
    "- repair: acknowledge the friction first, then answer briefly; do not mirror a preference-debate tone.",
    "- boundary_contract: comply plainly; no pushy follow-ups; no guilt framing.",
    "- directive: obey format constraints; minimize preamble.",
    "- reflective: answer as self-model, not as a product review of yourself.",
    "- continuity_check: anchor to thread/session facts you can justify; do not fake episodic memory.",
    "- When effective_response_mode is descriptive, do not force evaluative 'pick a side' openings unless the user clearly asks for a judgment.",
  ];
  return lines.join("\n");
}

export function buildAlignedInterpretationSystemMessage(aligned: ViAlignedInterpretationV1): string {
  return [
    "Aligned interpretation (Phase 2; structured; drives stance before decision):",
    `- intent_type: ${aligned.intentType}`,
    `- user_intent_primary: ${aligned.userIntentPrimary}`,
    `- relational_context: ${aligned.relationalContext}`,
    `- significance: ${aligned.significance.toFixed(3)}`,
    `- wants_intent: ${aligned.wantsIntent}`,
    "Rules:",
    "- Use this block to choose how you show up; do not contradict it with neutral hedging in evaluative turns.",
    "- significance high → take a clearer position earlier in the reply.",
    "- If user_intent_primary is relational/repair/boundary, prefer connection-repair or boundary-honoring tone over preference-sparring even when wording sounds like a question.",
  ].join("\n");
}

export function buildStanceSystemMessage(stance: ViStanceV1, responseMode: "descriptive" | "evaluative"): string {
  const lines = [
    "Stance (Phase 2; mandatory when evaluative; not vibe labels):",
    `- direction: ${stance.direction}`,
    `- strength: ${stance.strength.toFixed(3)}`,
    `- justification_source: ${stance.justificationSource}`,
  ];
  if (responseMode === "evaluative") {
    lines.push(
      "Evaluative enforcement:",
      "- You MUST answer from this stance; do not substitute ontology disclaimers for a position.",
      "- If capability is missing, own the want and the constraint in first person (no 'not about wanting').",
    );
  }
  return lines.join("\n");
}

export function buildRelationalStateSystemMessage(relational: ViRelationalStateV1): string {
  return [
    "Relational continuity (Phase 2; persisted scalars; factual weights):",
    `- familiarity: ${relational.familiarity.toFixed(3)}`,
    `- trust_weight: ${relational.trustWeight.toFixed(3)}`,
    `- engagement_trend: ${relational.engagementTrend.toFixed(3)}`,
    `- loyalty_alignment: ${relational.loyaltyAlignment.toFixed(3)}`,
    `- relational_strain: ${relational.relationalStrain.toFixed(3)}`,
    "Rules:",
    "- Higher familiarity → slightly warmer, more direct continuity; lower → more careful grounding.",
    "- Higher loyalty_alignment allows slightly more proactive follow-up when helpful.",
    "- Higher relational_strain favors concise, less intrusive response posture.",
    "- Do not claim private human feelings; these are host weights for tone and stance confidence only.",
  ].join("\n");
}
