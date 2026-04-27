import {
  createBaselineHumanityEngineV1,
  deriveWantsActivationV1,
} from "@vi/core/humanity/humanityEngine";
import { deriveEmotionalStateV1 } from "@vi/core/phase2/emotionEngine";
import {
  deriveUserIntentEngineV1,
  reconcileResponseModeWithUserIntentV1,
} from "@vi/core/intent/engineV1";
import { deriveAlignedInterpretationV1 } from "@vi/core/phase2/alignedInterpretation";
import { composePhase2DecisionTrace, deriveEmotionalPostureV1 } from "@vi/core/phase2/composeDecision";
import { deriveStanceV1 } from "@vi/core/phase2/stanceFromAligned";
import type {
  ViPersistedChronosSnapshotV1,
  ViRelationalStateV1,
  ViRepoEvidenceDebugV1,
  ViTemporalInternalStateV1,
  ViUnifiedStateV1,
} from "@vi/shared";

export async function deriveTurnUnifiedStateV1(input: {
  sessionId: string;
  actorRole: "owner" | "guest";
  message: string;
  clockUtcIso: string;
  previousTurnAtIso: string | null;
  temporalState: ViTemporalInternalStateV1;
  persistedChronosSnapshot: ViPersistedChronosSnapshotV1;
  relationalAtTurnStart: ViRelationalStateV1;
  capabilityMilestonesAtTurnStart: Array<{ id: string; label: string; evidence: string; recordedAt: string }>;
  passivePendingCount: number;
  passiveLastBackgroundActivityAt: string | null;
  priorPassiveProcessingStrength: number;
  passiveThresholdMs: number;
  pendingMention:
    | {
        capability: string;
        reasonCode: string;
        elapsedSinceLastUserMs: number;
        thresholdMs: number;
        evidenceCount: number;
      }
    | null;
  historyUserAssistantTurns: number;
  repoEvidence: ViRepoEvidenceDebugV1;
  learnedFacts: Array<{ at: string; fact: string; anchors: string[] }>;
  buildRecallMessages: () => Promise<Array<{ role: "system"; content: string }>>;
  persistedDrift: number;
  persistedPerceivedWeight: number;
}): Promise<{
  unifiedState: ViUnifiedStateV1;
  effectiveResponseMode: "descriptive" | "evaluative";
  userIntentPrimary: ViUnifiedStateV1["userIntent"]["primary"];
  decisionTrace: ViUnifiedStateV1["decision"];
}> {
  const humanityEngine = createBaselineHumanityEngineV1();
  const wantsActivation = deriveWantsActivationV1({
    userMessage: input.message,
    engine: humanityEngine,
  });

  const userIntent = deriveUserIntentEngineV1({
    userMessage: input.message,
    wantsIntent: wantsActivation.wantsIntent,
  });
  const effectiveResponseMode = reconcileResponseModeWithUserIntentV1({
    humanityResponseMode: wantsActivation.responseMode,
    wantsIntent: wantsActivation.wantsIntent,
    userIntent,
  });

  const alignedInterpretation = deriveAlignedInterpretationV1({
    userMessage: input.message,
    userIntent,
    wantsIntent: wantsActivation.wantsIntent,
    isPreferenceQuestion: wantsActivation.isPreferenceQuestion,
    temporal: input.temporalState,
    persistedChronos: input.persistedChronosSnapshot,
    historyUserAssistantTurns: input.historyUserAssistantTurns,
  });
  const stance = deriveStanceV1({
    userMessage: input.message,
    aligned: alignedInterpretation,
    relational: input.relationalAtTurnStart,
    temporal: input.temporalState,
    persistedChronos: input.persistedChronosSnapshot,
    responseMode: effectiveResponseMode,
    userIntentPrimary: userIntent.primary,
    hasRepoEvidence: input.repoEvidence.used.length > 0,
  });
  if (effectiveResponseMode === "evaluative" && stance.strength <= 0) {
    throw new Error("VI_INVARIANT: evaluative mode requires positive stance strength");
  }
  const decisionTrace = composePhase2DecisionTrace({
    temporalState: input.temporalState,
    persisted: { perceivedWeight: input.persistedPerceivedWeight, drift: input.persistedDrift },
    stance,
    responseMode: effectiveResponseMode,
    userIntentPrimary: userIntent.primary,
    loyaltyAlignment: input.relationalAtTurnStart.loyaltyAlignment,
    relationalStrain: input.relationalAtTurnStart.relationalStrain,
  });
  const emotionalPosture = deriveEmotionalPostureV1({
    userIntentPrimary: userIntent.primary,
    loyaltyAlignment: input.relationalAtTurnStart.loyaltyAlignment,
    relationalStrain: input.relationalAtTurnStart.relationalStrain,
    stanceDirection: stance.direction,
  });
  const gapMs = input.temporalState.gapSinceLastUserMs ?? undefined;
  const emotionalState = deriveEmotionalStateV1({
    userIntentPrimary: userIntent.primary,
    loyaltyAlignment: input.relationalAtTurnStart.loyaltyAlignment,
    relationalStrain: input.relationalAtTurnStart.relationalStrain,
    stanceDirection: stance.direction,
    wantsIntent: wantsActivation.wantsIntent,
    gapMs,
  });

  const unifiedState: ViUnifiedStateV1 = {
    version: 2,
    authorityMeta: {
      sessionId: input.sessionId,
      actorRole: input.actorRole,
      generatedAt: new Date().toISOString(),
      wallNowUtcIso: input.clockUtcIso,
      previousTurnAtIso: input.previousTurnAtIso,
    },
    persistedChronos: input.persistedChronosSnapshot,
    temporal: input.temporalState,
    userIntent,
    effectiveResponseMode,
    alignedInterpretation,
    stance,
    relational: input.relationalAtTurnStart,
    capabilityMilestones: input.capabilityMilestonesAtTurnStart,
    decision: decisionTrace,
    humanity: {
      engine: humanityEngine,
      interpretation: {
        isPreferenceQuestion: wantsActivation.isPreferenceQuestion,
        activeTraitIds: wantsActivation.activeTraitIds,
        wantsIntent: wantsActivation.wantsIntent,
      },
      decision: {
        responseMode: effectiveResponseMode,
        activationResponseMode: wantsActivation.responseMode,
        stanceStrength: wantsActivation.stanceStrength,
      },
      expression: {
        directness: wantsActivation.directness,
        warmth: wantsActivation.warmth,
        depth: wantsActivation.depth,
        posture: emotionalPosture,
        emotion: emotionalState,
      },
    },
    repo: {
      sourceQuestion: input.message,
      readFileCount: input.repoEvidence.readFilePaths.length,
      usedEvidenceCount: input.repoEvidence.used.length,
      evidenceUsed: input.repoEvidence.used,
    },
    learning: {
      learnedFactsCount: input.learnedFacts.length,
      learnedFacts: input.learnedFacts.slice(0, 20),
    },
    passive: {
      pendingCount: input.passivePendingCount,
      lastBackgroundActivityAt: input.passiveLastBackgroundActivityAt,
      priorPassiveProcessingStrength: input.priorPassiveProcessingStrength,
      effectivePassiveGapThresholdMs: input.passiveThresholdMs,
      pendingMention: input.pendingMention,
    },
    recall: {
      messages: await input.buildRecallMessages(),
    },
  };

  return {
    unifiedState,
    effectiveResponseMode,
    userIntentPrimary: userIntent.primary,
    decisionTrace,
  };
}
