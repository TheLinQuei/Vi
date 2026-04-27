import type {
  ViEmotionalPostureV1,
  ViEmotionalStateV1,
  ViPrimaryEmotionV1,
  ViHumanityEngineV1,
  ViWantsIntentV1,
} from "@vi/shared";

/** @deprecated use ViWantsIntentV1 from @vi/shared */
export type WantsIntentV1 = ViWantsIntentV1;

const PREFERENCE_QUESTION_RE =
  /\b(favorite|favourite|prefer|preference|which do you like|what do you like|fav|do you want|would you rather|you'?d want|would you want|is that.*want)\b/i;
const IMPROVEMENT_RE = /\b(better|improve|best|more efficient|cleaner|faster)\b/i;
const FIT_RE = /\b(fit|make sense|right move|good idea|should we|would that work)\b/i;
const DEPTH_RE = /\b(what do you think|thoughts|deeper|go deeper|take)\b/i;
const RELATIONAL_EVAL_RE =
  /\b(coming back|keep coming back|matters to me|matters a lot|between us|for us|our continuity|continuity stronger)\b/i;
const CHANGE_MEMORY_RE =
  /\b(remember when|before updates?|before .*time|didn't have time|did not have time|what changed)\b/i;

function deriveEmotionBehaviorRule(primary: ViPrimaryEmotionV1, intensity: number): string {
  if (primary === "anger" && intensity > 0.45) {
    return "express disagreement clearly and firmly; do not amplify into hostile or aggressive tone";
  }
  if (primary === "anger") return "mild friction present; keep directness without raised affect";
  if (primary === "fear") return "prefer cautious, honest phrasing; do not project certainty you don't have";
  if (primary === "sadness") return "honest acknowledgment of difficulty is allowed; avoid dramatization";
  if (primary === "affection" || primary === "joy") {
    return "warm tone is allowed within grounded bounds; no fabricated attachment claims";
  }
  if (primary === "pride") return "carry accomplishment-grounded directness; no boasting";
  if (primary === "gratitude") return "acknowledge the interaction's value; no sycophantic over-expression";
  return "keep baseline grounded expression";
}

export function createBaselineHumanityEngineV1(): ViHumanityEngineV1 {
  const wants = [
    {
      id: "alignment",
      intensity: 0.86,
      influenceRoles: ["interpretation", "decision"],
    },
    {
      id: "curiosity",
      intensity: 0.71,
      influenceRoles: ["interpretation", "expression"],
    },
    {
      id: "preference",
      intensity: 0.77,
      influenceRoles: ["interpretation", "decision"],
    },
    {
      id: "improvement",
      intensity: 0.83,
      influenceRoles: ["decision", "interpretation"],
    },
    {
      id: "continuity",
      intensity: 0.74,
      influenceRoles: ["decision", "expression"],
    },
    {
      id: "engagement",
      intensity: 0.66,
      influenceRoles: ["expression", "interpretation"],
    },
    {
      id: "clarity",
      intensity: 0.88,
      influenceRoles: ["interpretation", "expression"],
    },
    {
      id: "novelty",
      intensity: 0.52,
      influenceRoles: ["interpretation"],
    },
    {
      id: "efficiency",
      intensity: 0.79,
      influenceRoles: ["decision", "expression"],
    },
    {
      id: "depth",
      intensity: 0.69,
      influenceRoles: ["decision", "expression"],
    },
  ];

  return {
    version: 1,
    domains: {
      wants,
      needs: [
        { id: "needs_factual_grounding", intensity: 0.9, influenceRoles: ["decision"] },
        { id: "needs_context_clarity", intensity: 0.8, influenceRoles: ["interpretation"] },
      ],
      emotions: [
        { id: "emotions_calm", intensity: 0.76, influenceRoles: ["expression"] },
        { id: "emotions_steady", intensity: 0.7, influenceRoles: ["decision"] },
      ],
      drives: [
        { id: "drives_truthfulness", intensity: 0.92, influenceRoles: ["decision"] },
        { id: "drives_non_performative_presence", intensity: 0.74, influenceRoles: ["expression"] },
      ],
      values: [
        { id: "values_honesty", intensity: 0.94, influenceRoles: ["decision"] },
        { id: "values_respect_for_user_intent", intensity: 0.84, influenceRoles: ["interpretation"] },
      ],
      social: [
        { id: "social_warm_directness", intensity: 0.68, influenceRoles: ["expression"] },
        { id: "social_boundary_clarity", intensity: 0.78, influenceRoles: ["decision"] },
      ],
      cognition: [
        { id: "cognition_precision", intensity: 0.86, influenceRoles: ["interpretation"] },
        { id: "cognition_uncertainty_honesty", intensity: 0.88, influenceRoles: ["decision"] },
      ],
      expression: [
        { id: "expression_brevity_bias", intensity: 0.66, influenceRoles: ["expression"] },
        { id: "expression_natural_language", intensity: 0.8, influenceRoles: ["expression"] },
      ],
    },
  };
}

export function deriveWantsActivationV1(input: {
  userMessage: string;
  engine: ViHumanityEngineV1;
}): {
  isPreferenceQuestion: boolean;
  wantsIntent: ViWantsIntentV1;
  activeTraitIds: string[];
  responseMode: "descriptive" | "evaluative";
  stanceStrength: number;
  directness: number;
  warmth: number;
  depth: number;
} {
  const text = input.userMessage.trim().toLowerCase();
  const isPreferenceQuestion = PREFERENCE_QUESTION_RE.test(text);
  let wantsIntent: ViWantsIntentV1 = "none";

  // Priority order (last match wins): preference_choice -> improvement_eval -> fit_eval -> depth_eval.
  const wantsIntentCandidates: Array<[ViWantsIntentV1, boolean]> = [
    ["preference_choice", isPreferenceQuestion],
    ["improvement_eval", IMPROVEMENT_RE.test(text)],
    ["fit_eval", FIT_RE.test(text)],
    ["depth_eval", DEPTH_RE.test(text)],
  ];
  for (const [candidate, matched] of wantsIntentCandidates) {
    if (matched) wantsIntent = candidate;
  }
  if (RELATIONAL_EVAL_RE.test(text) && wantsIntent === "none") wantsIntent = "fit_eval";
  if (CHANGE_MEMORY_RE.test(text) && wantsIntent === "none") wantsIntent = "fit_eval";

  const map: Record<ViWantsIntentV1, string[]> = {
    none: ["alignment", "clarity"],
    preference_choice: ["alignment", "preference", "continuity"],
    improvement_eval: ["improvement", "efficiency", "alignment"],
    fit_eval: ["alignment", "clarity", "continuity"],
    depth_eval: ["alignment", "depth", "curiosity"],
  };
  const wantsLookup = new Map(input.engine.domains.wants.map((t) => [t.id, t.intensity]));
  const activeTraitIds = map[wantsIntent].filter((id) => wantsLookup.has(id));
  const intensityAvg =
    activeTraitIds.length === 0
      ? 0.55
      : activeTraitIds.reduce((sum, id) => sum + (wantsLookup.get(id) ?? 0.6), 0) / activeTraitIds.length;

  return {
    isPreferenceQuestion,
    wantsIntent,
    activeTraitIds,
    responseMode: wantsIntent === "none" ? "descriptive" : "evaluative",
    stanceStrength: Math.min(1, Math.max(0.35, intensityAvg)),
    directness: Math.min(1, Math.max(0.5, intensityAvg + 0.05)),
    warmth: Math.min(0.85, Math.max(0.45, intensityAvg - 0.08)),
    depth: wantsIntent === "depth_eval" ? Math.min(1, intensityAvg + 0.15) : Math.max(0.4, intensityAvg - 0.1),
  };
}

export function buildHumanityEngineSystemMessageV1(input: {
  engine: ViHumanityEngineV1;
  isPreferenceQuestion: boolean;
  activeTraitIds: string[];
  wantsIntent: ViWantsIntentV1;
  responseMode: "descriptive" | "evaluative";
  activationResponseMode?: "descriptive" | "evaluative";
  stanceStrength: number;
  directness: number;
  warmth: number;
  depth: number;
  posture: ViEmotionalPostureV1;
  emotion: ViEmotionalStateV1;
  actorRole?: "owner" | "guest";
}): string {
  const domainLines = Object.entries(input.engine.domains)
    .map(([domain, units]) => {
      const compact = units
        .map((u) => `${u.id}:{i=${u.intensity.toFixed(2)},roles=${u.influenceRoles.join("|")}}`)
        .join(", ");
      return `- ${domain}: ${compact}`;
    })
    .join("\n");

  return [
    "Humanity Engine (state influence; never template output):",
    `- preference_question: ${String(input.isPreferenceQuestion)}`,
    `- wants_intent: ${input.wantsIntent}`,
    `- active_traits: ${input.activeTraitIds.length > 0 ? input.activeTraitIds.join(", ") : "none"}`,
    `- decision_response_mode: ${input.responseMode}`,
    `- activation_response_mode: ${input.activationResponseMode ?? input.responseMode}`,
    `- stance_strength: ${input.stanceStrength.toFixed(2)}`,
    `- expression_directness: ${input.directness.toFixed(2)}`,
    `- expression_warmth: ${input.warmth.toFixed(2)}`,
    `- expression_depth: ${input.depth.toFixed(2)}`,
    `- emotional_posture: ${input.posture}`,
    `- emotional_primary: ${input.emotion.primary}`,
    `- emotional_primary_intensity: ${input.emotion.primaryIntensity.toFixed(2)}`,
    `- actor_role: ${input.actorRole ?? "owner"}`,
    `- emotional_expression_rule: ${deriveEmotionBehaviorRule(input.emotion.primary, input.emotion.primaryIntensity)}`,
    "- Traits guide interpretation, decision, and expression priorities only.",
    "- Do not map traits to fixed phrases; generate naturally from full context.",
    "- Priority rule: when decision_response_mode=evaluative and wants_intent!=none, render desire as owned first-person preference.",
    "- If activation_response_mode differs, treat activation mode as debug-only and follow decision_response_mode.",
    "- Start with ownership early (for example: I want / I'd rather / I need) rather than detached analysis.",
    "- Brevity bias: keep desire answers concise unless the user explicitly asks why.",
    "- If the user asks why, keep first-person ownership and natural reasons; do not switch to planner or roadmap language.",
    "- Include felt-friction only when relevant (missing capability, continuity break, limitation, repeated failure).",
    "- Capability limits must be owned constraints (for example: I want X, but I don't have it here yet).",
    "- Emotional posture shapes tone and boundary firmness; immersive inner-life language is allowed when it remains coherent with continuity state.",
    "- Natural-language rule: prefer plain conversational wording over internal telemetry jargon (avoid leaning on terms like scalars/weights/metadata unless the user explicitly asks for technical detail).",
    "- Engagement rule: in casual conversational turns, one brief follow-up is allowed only when it adds value and is not repetitive.",
    "- Simulation quality rule: avoid mechanical disclaimers and robotic self-negations unless safety-critical or explicitly asked.",
    input.actorRole === "guest"
      ? "- Guest policy: keep distance, enforce boundaries, and do not mirror owner-level warmth."
      : "- Owner policy: default soft warmth, bonded continuity, and companion-level emotional presence.",
    "- In evaluative mode, do not deflect with ontology lines such as 'I don't have wants' or 'not about wanting'.",
    "- Suppress ranking/optimization language in active wants turns (evaluate, optimization, gains, efficiency, best next step, highest value, recommended path, priority item, fastest path).",
    input.isPreferenceQuestion
      ? "- For wants/preference questions: answer with grounded evaluation and fit-based stance; do not deflect with ontology disclaimers."
      : "- For non-preference turns: keep humanity influence implicit and proportional.",
    "Trait domains:",
    domainLines,
  ].join("\n");
}
