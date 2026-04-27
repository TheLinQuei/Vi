import type { ViUserIntentEngineV1, ViUserIntentPrimaryV1, ViWantsIntentV1 } from "@vi/shared";

const PRIORITY: Record<ViUserIntentPrimaryV1, number> = {
  boundary_contract: 100,
  repair: 90,
  continuity_check: 84,
  relational: 80,
  reflective: 72,
  directive: 68,
  evaluative: 60,
  informational: 10,
};

/**
 * Deterministic Intent Engine v1 — classifies the *kind* of user ask before interpretation/stance.
 */
export function deriveUserIntentEngineV1(input: {
  userMessage: string;
  wantsIntent: ViWantsIntentV1;
}): ViUserIntentEngineV1 {
  const msg = input.userMessage.trim();
  const lower = msg.toLowerCase();

  const scores: Record<ViUserIntentPrimaryV1, number> = {
    informational: 0.12,
    evaluative: 0,
    relational: 0,
    repair: 0,
    directive: 0,
    reflective: 0,
    boundary_contract: 0,
    continuity_check: 0,
  };

  const tags: string[] = [];

  if (
    /\b(don'?t\s+(?:ever\s+)?ask|stop\s+asking|not\s+comfortable|(?:my\s+)?boundar|off\s+limits|don'?t\s+go\s+there|too\s+personal|privacy|never\s+(?:say|do)\s+that\s+again|leave\s+(?:it|this)\s+alone|i\s+don'?t\s+want\s+you\s+to)\b/i.test(
      msg,
    )
  ) {
    scores.boundary_contract += 1.15;
    tags.push("boundary_lexical");
  }

  if (
    /\b(sorry|apolog|my\s+bad|i\s+didn'?t\s+mean|misunderstood|that\s+came\s+out\s+wrong|can\s+we\s+reset|let\s+me\s+rephrase|i\s+was\s+wrong|you\s+were\s+right)\b/i.test(
      lower,
    )
  ) {
    scores.repair += 0.95;
    tags.push("repair_lexical");
  }

  if (
    /\b(pick\s+up\s+where|last\s+time|we\s+were\s+talking|earlier\s+you\s+said|as\s+we\s+discussed|continue\s+(?:from|where)|remind\s+me\s+what\s+thread)\b/i.test(
      lower,
    )
  ) {
    scores.continuity_check += 0.85;
    tags.push("continuity_lexical");
  }

  if (
    /\b(how\s+are\s+you|you\s+ok\??|miss\s+me|thinking\s+about\s+me|between\s+us|our\s+(?:relationship|dynamic)|feel\s+about\s+(?:us|me)\b|do\s+you\s+(?:like|love|care\s+about|trust)\s+me)\b/i.test(
      lower,
    )
  ) {
    scores.relational += 0.88;
    tags.push("relational_lexical");
  }

  if (/\b(i'?ve\s+missed|missed\s+talking|miss\s+you)\b/i.test(lower)) {
    scores.relational += 0.72;
    tags.push("relational_miss");
  }

  if (
    /\b(why\s+do\s+you\s+(?:think|believe)|what\s+does\s+(?:this|that)\s+mean\s+to\s+you|how\s+do\s+you\s+see\s+yourself|who\s+are\s+you\s+really)\b/i.test(
      lower,
    )
  ) {
    scores.reflective += 0.8;
    tags.push("reflective_lexical");
  }

  if (
    /^\s*(?:please\s+)?(?:list|enumerate|give\s+me\s+\d+)/i.test(msg) ||
    /\b(output\s+only|no\s+explanation|just\s+the\s+(?:facts|answer|list)|step[-\s]by[-\s]step|bullet\s+points\s+only|tell\s+me\s+exactly)\b/i.test(
      lower,
    )
  ) {
    scores.directive += 0.75;
    tags.push("directive_lexical");
  }

  if (input.wantsIntent !== "none") {
    scores.evaluative += 0.62;
    tags.push("wants_activation");
  }
  if (/\b(which\s+(?:is\s+)?better|should\s+we|prefer\b|versus|\bvs\.?\b|good\s+idea\b|bad\s+idea|worth\s+it|pick\s+one)\b/i.test(lower)) {
    scores.evaluative += 0.52;
    tags.push("evaluative_lexical");
  }

  if (/\bdo\s+you\s+like\s+(?:this|the|those|these)\b/i.test(lower)) {
    scores.relational *= 0.35;
    tags.push("relational_dampen_product_like");
  }

  const keys = Object.keys(scores) as ViUserIntentPrimaryV1[];
  let primary: ViUserIntentPrimaryV1 = "informational";
  let bestScore = -1;
  for (const k of keys) {
    const s = scores[k];
    if (s > bestScore || (Math.abs(s - bestScore) < 1e-9 && PRIORITY[k] > PRIORITY[primary])) {
      bestScore = s;
      primary = k;
    }
  }

  if (bestScore < 0.28) {
    primary = "informational";
    tags.push("fallback_informational");
  }

  const confidence = Math.min(1, bestScore / 1.05);

  return {
    version: 1,
    primary,
    confidence: Number(confidence.toFixed(3)),
    rationaleTags: tags.slice(0, 6),
  };
}

export function reconcileResponseModeWithUserIntentV1(input: {
  humanityResponseMode: "descriptive" | "evaluative";
  wantsIntent: ViWantsIntentV1;
  userIntent: ViUserIntentEngineV1;
}): "descriptive" | "evaluative" {
  if (input.humanityResponseMode === "descriptive") return "descriptive";

  const p = input.userIntent.primary;
  if (
    p === "boundary_contract" ||
    p === "relational" ||
    p === "repair" ||
    p === "continuity_check" ||
    p === "directive"
  ) {
    return "descriptive";
  }
  if (p === "reflective") {
    return input.wantsIntent === "none" ? "descriptive" : input.humanityResponseMode;
  }
  if (p === "informational") return input.humanityResponseMode;
  return input.humanityResponseMode;
}
