import type { ViIntentTypeV1, ViUserIntentPrimaryV1, ViWantsIntentV1 } from "@vi/shared";

/** Maps Intent Engine primary class onto legacy Phase-2 intent_type (compatibility + system prompts). */
export function mapAlignedIntentTypeFromUserIntentV1(input: {
  userIntentPrimary: ViUserIntentPrimaryV1;
  wantsIntent: ViWantsIntentV1;
  isPreferenceQuestion: boolean;
}): ViIntentTypeV1 {
  const { userIntentPrimary, wantsIntent, isPreferenceQuestion } = input;
  if (userIntentPrimary === "boundary_contract" || userIntentPrimary === "directive") {
    return "informational";
  }
  if (
    userIntentPrimary === "repair" ||
    userIntentPrimary === "relational" ||
    userIntentPrimary === "continuity_check"
  ) {
    return "relational_check";
  }
  if (userIntentPrimary === "reflective") {
    return wantsIntent === "none" ? "informational" : "evaluative_probe";
  }
  if (userIntentPrimary === "evaluative") {
    if (isPreferenceQuestion || wantsIntent === "preference_choice") return "preference_or_fit";
    return "evaluative_probe";
  }
  if (wantsIntent !== "none") return "evaluative_probe";
  return "informational";
}
