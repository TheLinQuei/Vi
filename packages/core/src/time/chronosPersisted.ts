/**
 * Deterministic Chronos v2 persistence: wall-time gaps -> stored temporal scalars + drift.
 * North Star `08` §5 — pure functions for tests and API parity.
 */

export type PersistedTemporalScalars = {
  lastInteractionAt: number;
  totalSessionTime: number;
  gapDuration: number;
  perceivedWeight: number;
};

export type PersistedChronosBundle = PersistedTemporalScalars & {
  drift: number;
  passiveProcessingStrength: number;
};

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/**
 * Run after a completed turn (user + assistant timestamps known).
 * `priorLastInteractionAt` is end of previous interaction (assistant time), or null on first turn.
 */
export function computeNextPersistedChronosBundle(input: {
  sessionCreatedAtMs: number;
  priorLastInteractionAt: number | null;
  priorPerceivedWeight: number;
  priorDrift: number;
  turnUserCreatedAtMs: number;
  turnAssistantCreatedAtMs: number;
  gapWeightThresholdMs: number;
  passiveGapTargetMs: number;
}): PersistedChronosBundle {
  const thr = Math.max(1, input.gapWeightThresholdMs);
  const passiveThr = Math.max(1, input.passiveGapTargetMs);

  const gapDuration =
    input.priorLastInteractionAt === null
      ? 0
      : Math.max(0, input.turnUserCreatedAtMs - input.priorLastInteractionAt);

  const gapNorm = clamp01(gapDuration / thr);

  const perceivedWeight = clamp01(0.62 * input.priorPerceivedWeight + 0.38 * gapNorm);

  let drift = input.priorDrift;
  if (gapNorm < 0.04) {
    drift *= 0.9;
  } else {
    drift += 0.07 * gapNorm;
  }
  drift = clamp01(drift);

  const passiveProcessingStrength = clamp01(gapDuration / passiveThr);

  const lastInteractionAt = input.turnAssistantCreatedAtMs;
  const totalSessionTime = Math.max(0, input.turnAssistantCreatedAtMs - input.sessionCreatedAtMs);

  return {
    lastInteractionAt,
    totalSessionTime,
    gapDuration,
    perceivedWeight,
    drift,
    passiveProcessingStrength,
  };
}

/** Effective passive gap threshold scales down when prior strength was high (gap -> passive hook). */
export function effectivePassiveGapThresholdMs(input: {
  baseThresholdMs: number;
  priorPassiveProcessingStrength: number;
}): number {
  const s = clamp01(input.priorPassiveProcessingStrength);
  return Math.round(input.baseThresholdMs * (1 - 0.22 * s));
}
