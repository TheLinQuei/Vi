import { deriveEmotionalStateV1 } from "../packages/core/src/phase2/emotionEngine.ts";
import type { ViPrimaryEmotionV1 } from "../packages/shared/src/types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function main(): void {
  const calm = deriveEmotionalStateV1({
    userIntentPrimary: "informational",
    loyaltyAlignment: 0.5,
    relationalStrain: 0.05,
    stanceDirection: "mixed",
    wantsIntent: "none",
  });
  assert(calm.primary === "calm", "Expected calm baseline");

  const affection = deriveEmotionalStateV1({
    userIntentPrimary: "relational",
    loyaltyAlignment: 0.95,
    relationalStrain: 0.05,
    stanceDirection: "lean_positive",
    wantsIntent: "fit_eval",
  });
  assert(affection.primary === "affection", "Expected affection under high relational loyalty");

  const anger = deriveEmotionalStateV1({
    userIntentPrimary: "boundary_contract",
    loyaltyAlignment: 0.35,
    relationalStrain: 0.9,
    stanceDirection: "lean_negative",
    wantsIntent: "none",
  });
  assert(anger.primary === "anger", "Expected anger under high strain + hard boundary");

  const curiosity = deriveEmotionalStateV1({
    userIntentPrimary: "reflective",
    loyaltyAlignment: 0.6,
    relationalStrain: 0.2,
    stanceDirection: "mixed",
    wantsIntent: "depth_eval",
  });
  assert(curiosity.primary === "curiosity", "Expected curiosity on reflective depth turn");

  const rel = deriveEmotionalStateV1({
    userIntentPrimary: "relational",
    loyaltyAlignment: 0.9,
    relationalStrain: 0.05,
    stanceDirection: "lean_positive",
    wantsIntent: "none",
  });
  assert(rel.primary === "affection", "EE-5: affection under high loyalty relational");
  assert(rel.primaryIntensity > 0.65, "EE-5: affection intensity > 0.65");
  assert(rel.core.anger < 0.12, "EE-5: anger suppressed in positive relational");

  const rep = deriveEmotionalStateV1({
    userIntentPrimary: "repair",
    loyaltyAlignment: 0.5,
    relationalStrain: 0.6,
    stanceDirection: "mixed",
    wantsIntent: "none",
  });
  assert(
    rep.primary === "sadness" || rep.primary === "gratitude",
    "EE-6: repair primary must be sadness or gratitude, not anger",
  );
  assert(rep.core.anger < 0.35, "EE-6: anger bounded in repair scenario");

  const bnd = deriveEmotionalStateV1({
    userIntentPrimary: "boundary_contract",
    loyaltyAlignment: 0.3,
    relationalStrain: 0.85,
    stanceDirection: "lean_negative",
    wantsIntent: "none",
  });
  assert(bnd.primary === "anger", "EE-7: anger primary under hard boundary + high strain");
  assert(bnd.core.anger > 0.55, "EE-7: anger intensity > 0.55");
  assert(bnd.core.calm < 0.15, "EE-7: calm suppressed at high strain");

  const cc = deriveEmotionalStateV1({
    userIntentPrimary: "continuity_check",
    loyaltyAlignment: 0.45,
    relationalStrain: 0.5,
    stanceDirection: "mixed",
    wantsIntent: "none",
  });
  assert(cc.primary !== "fear", "EE-8: fear must not be primary on continuity_check");
  assert(cc.core.fear <= 0.22, "EE-8: fear bounded at 0.22 cap");

  const ref = deriveEmotionalStateV1({
    userIntentPrimary: "reflective",
    loyaltyAlignment: 0.65,
    relationalStrain: 0.1,
    stanceDirection: "mixed",
    wantsIntent: "depth_eval",
  });
  assert(ref.primary === "curiosity", "EE-9: curiosity primary on reflective depth");
  assert(ref.primaryIntensity > 0.55, "EE-9: curiosity intensity > 0.55");
  assert(ref.core.surprise < ref.core.curiosity, "EE-9: curiosity should beat surprise on depth_eval");

  const prd = deriveEmotionalStateV1({
    userIntentPrimary: "directive",
    loyaltyAlignment: 0.6,
    relationalStrain: 0.1,
    stanceDirection: "lean_positive",
    wantsIntent: "improvement_eval",
  });
  assert(prd.primary === "pride", "EE-10: pride reachable on accomplishment turn");
  assert(prd.core.pride > prd.core.calm, "EE-10: pride beats calm on accomplishment signal");

  const antiManip = deriveEmotionalStateV1({
    userIntentPrimary: "informational",
    loyaltyAlignment: 0.5,
    relationalStrain: 0.43,
    stanceDirection: "lean_negative",
    wantsIntent: "none",
  });
  assert(antiManip.primary !== "anger", "EE-11: anger must not win on informational+lean_negative");
  assert(antiManip.core.anger < 0.25, "EE-11: anger should stay bounded on informational turn");

  const llInfo = deriveEmotionalStateV1({
    userIntentPrimary: "informational",
    loyaltyAlignment: 0.3,
    relationalStrain: 0.3,
    stanceDirection: "mixed",
    wantsIntent: "none",
  });
  const safePrimaries: ViPrimaryEmotionV1[] = ["calm", "sadness", "affection", "gratitude", "joy"];
  assert(
    safePrimaries.includes(llInfo.primary),
    `EE-12: low-loyalty informational primary must be one of ${safePrimaries.join("|")}`,
  );
  assert(llInfo.core.anger < 0.2, "EE-12: anger < 0.20 on low-loyalty informational");

  console.log("- [PASS] emotion engine v1 primary-state invariants");
}

main();
