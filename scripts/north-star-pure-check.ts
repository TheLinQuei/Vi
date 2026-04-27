/**
 * North Star §8 row 7 — pure proofs without live API / LLM.
 * Run: pnpm north-star:check
 */
import assert from "node:assert/strict";

import { composePhase2DecisionTrace } from "../packages/core/src/phase2/composeDecision.ts";
import { deriveTemporalDecisionTrace } from "../packages/core/src/decision/temporalDecisionPolicy.ts";
import {
  computeNextPersistedChronosBundle,
  effectivePassiveGapThresholdMs,
} from "../packages/core/src/time/chronosPersisted.ts";
import type { ViTemporalInternalStateV1 } from "../packages/shared/src/types.ts";

const thr = 30 * 60 * 1000;
const passiveThr = 30 * 60 * 1000;

const substantiveLowGap: ViTemporalInternalStateV1 = {
  version: 1,
  wallNowUtcIso: "2026-01-01T00:00:00.000Z",
  wallNowEpochMs: 1_000_000,
  gapSinceLastUserMs: 5_000,
  threadSpanMs: 60_000,
  gapNormalizedWeight: 0.05,
  turnClass: "substantive",
  gapWeightThresholdMs: thr,
};

const traceLowDrift = deriveTemporalDecisionTrace(substantiveLowGap, { perceivedWeight: 0, drift: 0 });
const traceHighDrift = deriveTemporalDecisionTrace(substantiveLowGap, { perceivedWeight: 0.1, drift: 0.72 });
assert.notEqual(
  traceLowDrift.responsePolicy.brevityTarget,
  traceHighDrift.responsePolicy.brevityTarget,
  "high drift must change brevity vs low drift (same turn-class / live gap)",
);

const t0 = 1_700_000_000_000;
const afterLongGap = computeNextPersistedChronosBundle({
  sessionCreatedAtMs: t0,
  priorLastInteractionAt: t0 + 60_000,
  priorPerceivedWeight: 0,
  priorDrift: 0,
  turnUserCreatedAtMs: t0 + 60_000 + 2 * thr,
  turnAssistantCreatedAtMs: t0 + 60_000 + 2 * thr + 5_000,
  gapWeightThresholdMs: thr,
  passiveGapTargetMs: passiveThr,
});
assert.ok(afterLongGap.gapDuration > thr, "gap duration should reflect absence");
assert.ok(afterLongGap.drift > 0, "drift should increase after meaningful gap");
assert.ok(afterLongGap.passiveProcessingStrength > 0.5, "passive strength should rise with long gap");

const eff = effectivePassiveGapThresholdMs({
  baseThresholdMs: passiveThr,
  priorPassiveProcessingStrength: 0.9,
});
assert.ok(eff < passiveThr, "high prior passive strength should lower effective threshold");

const stancePos = { version: 1 as const, direction: "lean_positive" as const, strength: 0.7, justificationSource: "state" as const };
const stanceNeg = { version: 1 as const, direction: "lean_negative" as const, strength: 0.75, justificationSource: "state" as const };
const mergedPos = composePhase2DecisionTrace({
  temporalState: substantiveLowGap,
  persisted: { perceivedWeight: 0.1, drift: 0.2 },
  stance: stancePos,
  responseMode: "evaluative",
  userIntentPrimary: "informational",
});
const mergedNeg = composePhase2DecisionTrace({
  temporalState: substantiveLowGap,
  persisted: { perceivedWeight: 0.1, drift: 0.2 },
  stance: stanceNeg,
  responseMode: "evaluative",
  userIntentPrimary: "informational",
});
assert.notEqual(
  mergedPos.responsePolicy.brevityTarget,
  mergedNeg.responsePolicy.brevityTarget,
  "Phase 2 stance direction must change composed decision policy",
);
assert.ok(mergedPos.phase2 && mergedNeg.phase2, "phase2 trace metadata present");

const boundaryBrief = composePhase2DecisionTrace({
  temporalState: substantiveLowGap,
  persisted: { perceivedWeight: 0.1, drift: 0.2 },
  stance: stancePos,
  responseMode: "evaluative",
  userIntentPrimary: "boundary_contract",
});
assert.equal(boundaryBrief.responsePolicy.brevityTarget, "brief");
assert.equal(boundaryBrief.responsePolicy.followUpQuestionLikelihood, "low");

console.log("north-star:check OK (pure Chronos + decision proofs)");
