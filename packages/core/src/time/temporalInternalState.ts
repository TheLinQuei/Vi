import type { ViTemporalInternalStateV1 } from "@vi/shared";
import type { AuthoritativeTime } from "./chronosClock.js";
import { isRelationalPresenceCue, isSubstantiveConversationTurn } from "./conversationTurnSignals.js";

export type { ViTemporalInternalStateV1 } from "@vi/shared";

export function buildViTemporalInternalStateV1(input: {
  authoritativeTime: AuthoritativeTime;
  userMessage: string;
  previousUserMessageAt: Date | null;
  firstThreadMessageAt: Date | null;
  gapWeightThresholdMs: number;
}): ViTemporalInternalStateV1 {
  const { utc, epochMs } = input.authoritativeTime;

  const gapSinceLastUserMs =
    input.previousUserMessageAt === null
      ? null
      : Math.max(0, epochMs - input.previousUserMessageAt.getTime());

  const threadSpanMs =
    input.firstThreadMessageAt === null ? null : Math.max(0, epochMs - input.firstThreadMessageAt.getTime());

  let turnClass: ViTemporalInternalStateV1["turnClass"] = "neutral";
  if (isRelationalPresenceCue(input.userMessage)) {
    turnClass = "presence_cue";
  } else if (isSubstantiveConversationTurn(input.userMessage)) {
    turnClass = "substantive";
  }

  const thr = input.gapWeightThresholdMs;
  const gapNormalizedWeight =
    gapSinceLastUserMs === null || thr <= 0 ? 0 : Math.min(1, gapSinceLastUserMs / thr);

  return {
    version: 1,
    wallNowUtcIso: utc,
    wallNowEpochMs: epochMs,
    gapSinceLastUserMs,
    threadSpanMs,
    gapNormalizedWeight,
    turnClass,
    gapWeightThresholdMs: thr,
  };
}

/**
 * Factual system block: host-computed internal temporal instrumentation (not phenomenology).
 */
export function buildTemporalInternalStateSystemMessage(state: ViTemporalInternalStateV1): string {
  return [
    "Internal temporal state (bounded instrumentation; factual; not subjective feeling):",
    `- schema_version: ${state.version}`,
    `- wall_now_utc_iso: ${state.wallNowUtcIso}`,
    `- wall_now_epoch_ms: ${state.wallNowEpochMs}`,
    `- gap_since_last_user_message_ms: ${state.gapSinceLastUserMs === null ? "null (no prior user message in thread)" : state.gapSinceLastUserMs}`,
    `- thread_span_ms (first stored thread message → wall now): ${state.threadSpanMs === null ? "null" : state.threadSpanMs}`,
    `- gap_weight_threshold_ms: ${state.gapWeightThresholdMs}`,
    `- gap_normalized_weight (0..1 vs threshold): ${state.gapNormalizedWeight}`,
    `- turn_class (routing signal only): ${state.turnClass}`,
    "Use turn_class to modulate response depth only: presence_cue → keep replies brief; substantive → fuller reasoning is allowed; neutral → default.",
    "Do not describe this block as something you felt internally; it is host metadata.",
  ].join("\n");
}
