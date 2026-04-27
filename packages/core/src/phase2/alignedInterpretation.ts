import type {
  ViAlignedInterpretationV1,
  ViPersistedChronosSnapshotV1,
  ViRelationalContextSignalV1,
  ViTemporalInternalStateV1,
  ViUserIntentEngineV1,
  ViUserIntentPrimaryV1,
  ViWantsIntentV1,
} from "@vi/shared";
import { mapAlignedIntentTypeFromUserIntentV1 } from "../intent/mapAlignedIntentFromUserIntentV1.js";

const GAP_RETURNING_MS = 45 * 60 * 1000;

/**
 * Phase 2 — structured interpretation from unified turn facts (not free prompt text).
 */
function significanceFromUserIntent(input: {
  primary: ViUserIntentPrimaryV1;
  wantsIntent: ViWantsIntentV1;
  temporal: ViTemporalInternalStateV1;
  persistedChronos: ViPersistedChronosSnapshotV1;
}): number {
  let base = input.wantsIntent === "none" ? 0.22 : 0.62;
  switch (input.primary) {
    case "boundary_contract":
      base = Math.max(base, 0.58);
      break;
    case "repair":
      base = Math.max(base, 0.52);
      break;
    case "relational":
      base = Math.max(base, 0.46);
      break;
    case "continuity_check":
      base = Math.max(base, 0.44);
      break;
    case "reflective":
      base = Math.max(base, 0.4);
      break;
    case "directive":
      base = Math.max(base, 0.36);
      break;
    default:
      break;
  }
  return Math.min(
    1,
    base + 0.14 * input.temporal.gapNormalizedWeight + 0.12 * input.persistedChronos.drift,
  );
}

export function deriveAlignedInterpretationV1(input: {
  userMessage: string;
  userIntent: ViUserIntentEngineV1;
  wantsIntent: ViWantsIntentV1;
  isPreferenceQuestion: boolean;
  temporal: ViTemporalInternalStateV1;
  persistedChronos: ViPersistedChronosSnapshotV1;
  /** Recent user+assistant rows loaded for this model call (0 = first substantive thread turn). */
  historyUserAssistantTurns: number;
}): ViAlignedInterpretationV1 {
  const wantsIntent = input.wantsIntent;
  const userIntentPrimary = input.userIntent.primary;
  let intentType = mapAlignedIntentTypeFromUserIntentV1({
    userIntentPrimary,
    wantsIntent,
    isPreferenceQuestion: input.isPreferenceQuestion,
  });
  if (intentType === "informational" && input.userMessage.trim().split(/\s+/).length <= 3) {
    intentType = "ambiguous";
  }

  let relationalContext: ViRelationalContextSignalV1 = "ongoing";
  if (input.historyUserAssistantTurns === 0) {
    relationalContext = "new_thread";
  }
  if (
    input.historyUserAssistantTurns > 0 &&
    (input.persistedChronos.lastGapDuration >= GAP_RETURNING_MS ||
      input.temporal.gapNormalizedWeight >= 0.55)
  ) {
    relationalContext = "returning_after_gap";
  }
  if (input.historyUserAssistantTurns > 0 && input.persistedChronos.perceivedWeight > 0.35) {
    relationalContext = "continuity_weighted";
  }

  const significance = significanceFromUserIntent({
    primary: userIntentPrimary,
    wantsIntent,
    temporal: input.temporal,
    persistedChronos: input.persistedChronos,
  });

  return {
    version: 1,
    intentType,
    userIntentPrimary,
    relationalContext,
    significance,
    wantsIntent,
  };
}
