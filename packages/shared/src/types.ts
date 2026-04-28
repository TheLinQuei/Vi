export type ChatRequest = {
  message: string;
  sessionId?: string;
  /** Optional hints for future adapters; API rejects override keys inside (`moduleAdapter`). */
  context?: Record<string, unknown>;
};

/** Server wall times for this turn (ISO 8601). Lets the UI verify Vi’s time claims. */
export type ChatTurnChronos = {
  serverNow: string;
  userMessageAt: string;
  assistantMessageAt: string;
};

/**
 * B2+B9 — bounded, inspectable temporal instrumentation derived from Chronos + turn shape.
 * Not phenomenology; safe to surface in UI and logs.
 */
export type ViTemporalInternalStateV1 = {
  version: 1;
  wallNowUtcIso: string;
  wallNowEpochMs: number;
  gapSinceLastUserMs: number | null;
  threadSpanMs: number | null;
  /** min(1, gap / gapWeightThresholdMs); 0 when no prior user message. */
  gapNormalizedWeight: number;
  turnClass: "presence_cue" | "substantive" | "neutral";
  gapWeightThresholdMs: number;
};

export type ViGapWeightBandV1 = "short_gap" | "settled_gap" | "meaningful_gap";

export type ViResponsePolicyV1 = {
  brevityTarget: "brief" | "balanced" | "full";
  followUpQuestionLikelihood: "low" | "medium";
};

export type ViEmotionalPostureV1 = "steady" | "warm" | "firm" | "protective" | "strained";
export type ViPrimaryEmotionV1 =
  | "joy"
  | "sadness"
  | "anger"
  | "fear"
  | "surprise"
  | "affection"
  | "curiosity"
  | "calm"
  | "pride"
  | "gratitude";

export type ViEmotionalStateV1 = {
  version: 1;
  primary: ViPrimaryEmotionV1;
  /** 0..1 confidence-like intensity for primary emotion. */
  primaryIntensity: number;
  /** Inspectable bounded intensities for V1 core emotions. */
  core: Record<ViPrimaryEmotionV1, number>;
};

/**
 * Dev/debug trace for state -> decision policy routing.
 */
export type ViDecisionTraceV1 = {
  version: 1;
  turnClass: ViTemporalInternalStateV1["turnClass"];
  gapWeightBand: ViGapWeightBandV1;
  responsePolicy: ViResponsePolicyV1;
  /** Persisted scalars that influenced this trace (observability; North Star §8). */
  persistedInfluence?: {
    perceivedWeight: number;
    drift: number;
    effectiveGapNormalizedWeight: number;
  };
  /** Phase 2 — stance + Chronos engagement shaping applied after temporal banding. */
  phase2?: {
    stanceDirection: "lean_positive" | "lean_negative" | "mixed";
    stanceStrength: number;
    chronosEngagementShaping: number;
    emotionalPosture?: ViEmotionalPostureV1;
  };
};

export type ViRepoEvidenceItemV1 = {
  filePath: string;
  snippet: string;
  relevanceScore: number;
  whySelected?: {
    tokenHits: string[];
    highSignalHits: string[];
    symbolHintHit: boolean;
    pathHintHit: boolean;
    fileTypeBoost: "code" | "docs" | "none";
  };
};

export type ViRepoEvidenceDebugV1 = {
  readFilePaths: string[];
  used: ViRepoEvidenceItemV1[];
};

export type ViTraitInfluenceRoleV1 = "interpretation" | "decision" | "expression";

export type ViTraitUnitV1 = {
  id: string;
  /** Bounded trait activation/intensity in [0, 1]. */
  intensity: number;
  influenceRoles: ViTraitInfluenceRoleV1[];
};

export type ViHumanityDomainIdV1 =
  | "wants"
  | "needs"
  | "emotions"
  | "drives"
  | "values"
  | "social"
  | "cognition"
  | "expression";

export type ViHumanityEngineV1 = {
  version: 1;
  domains: Record<ViHumanityDomainIdV1, ViTraitUnitV1[]>;
};

/** Durable session Chronos + interior (Postgres-backed). */
export type ViPersistedChronosSnapshotV1 = {
  version: 1;
  lastInteractionAt: number | null;
  totalSessionTime: number;
  lastGapDuration: number;
  perceivedWeight: number;
  drift: number;
  passiveProcessingStrength: number;
};

export type ViWantsIntentV1 =
  | "none"
  | "preference_choice"
  | "improvement_eval"
  | "fit_eval"
  | "depth_eval";

/**
 * Intent Engine v1 — what kind of ask the user is making (orthogonal to wants activation).
 * Drives interpretation, stance routing, relational deltas, and expression policy.
 */
export type ViUserIntentPrimaryV1 =
  | "informational"
  | "evaluative"
  | "relational"
  | "repair"
  | "directive"
  | "reflective"
  | "boundary_contract"
  | "continuity_check";

export type ViUserIntentEngineV1 = {
  version: 1;
  primary: ViUserIntentPrimaryV1;
  /** 0..1 — winner strength vs baseline bucket. */
  confidence: number;
  /** Short deterministic tags for inspection / eval (not shown to the user). */
  rationaleTags: string[];
};

export type ViIntentTypeV1 =
  | "informational"
  | "evaluative_probe"
  | "relational_check"
  | "preference_or_fit"
  | "ambiguous";

export type ViRelationalContextSignalV1 =
  | "new_thread"
  | "ongoing"
  | "returning_after_gap"
  | "continuity_weighted";

/** Phase 2 — structured interpretation before stance (see `09-north-star-77ez-phase2`). */
export type ViAlignedInterpretationV1 = {
  version: 1;
  intentType: ViIntentTypeV1;
  /** Intent Engine v1 primary class (source of truth for ask-shape). */
  userIntentPrimary: ViUserIntentPrimaryV1;
  relationalContext: ViRelationalContextSignalV1;
  /** 0..1 — how strongly this turn should drive stance/decision. */
  significance: number;
  wantsIntent: ViWantsIntentV1;
};

export type ViStanceDirectionV1 = "lean_positive" | "lean_negative" | "mixed";

export type ViStanceJustificationSourceV1 = "state" | "evidence" | "uncertain";

export type ViStanceV1 = {
  version: 1;
  direction: ViStanceDirectionV1;
  /** 0..1 */
  strength: number;
  justificationSource: ViStanceJustificationSourceV1;
};

/** Persisted relationship scalars (Postgres). Phase 2 minimum. */
export type ViRelationalStateV1 = {
  version: 1;
  /** Continuity comfort built from repeated healthy interaction. */
  familiarity: number;
  /** Trust in turn-level judgment and alignment. */
  trustWeight: number;
  /** Momentum of engagement across turns/gaps. */
  engagementTrend: number;
  /** Loyalty-alignment scalar (dynamic; not blind obedience). */
  loyaltyAlignment: number;
  /** Accumulated relational strain from disrespect/coercion patterns. */
  relationalStrain: number;
};

/** Persistent change-history markers for capability growth over updates. */
export type ViCapabilityMilestoneV1 = {
  id: string;
  label: string;
  evidence: string;
  recordedAt: string;
};

export type ViUnifiedStateV1 = {
  version: 2;
  authorityMeta: {
    sessionId: string;
    actorRole: "owner" | "guest";
    generatedAt: string;
    wallNowUtcIso: string;
    previousTurnAtIso: string | null;
  };
  /** Values loaded at turn start (before this turn’s persistence write). */
  persistedChronos: ViPersistedChronosSnapshotV1;
  temporal: ViTemporalInternalStateV1;
  userIntent: ViUserIntentEngineV1;
  /**
   * Material response routing after intent reconciliation (stance, voice enforcement, decision overlays).
   * Pre-reconciliation activation mode is preserved at `humanity.decision.activationResponseMode`.
   */
  effectiveResponseMode: "descriptive" | "evaluative";
  alignedInterpretation: ViAlignedInterpretationV1;
  stance: ViStanceV1;
  /** Relational snapshot at turn start (before persistence write for this turn). */
  relational: ViRelationalStateV1;
  capabilityMilestones: ViCapabilityMilestoneV1[];
  decision: ViDecisionTraceV1;
  humanity: {
    engine: ViHumanityEngineV1;
    interpretation: {
      isPreferenceQuestion: boolean;
      activeTraitIds: string[];
      wantsIntent: ViWantsIntentV1;
    };
    decision: {
      /**
       * Final authoritative routing mode after intent reconciliation.
       * This should match `effectiveResponseMode`.
       */
      responseMode: "descriptive" | "evaluative";
      /** Raw humanity activation mode before intent reconciliation (debug only). */
      activationResponseMode: "descriptive" | "evaluative";
      stanceStrength: number;
    };
    expression: {
      directness: number;
      warmth: number;
      depth: number;
      posture: ViEmotionalPostureV1;
      emotion: ViEmotionalStateV1;
    };
  };
  repo: {
    sourceQuestion: string;
    readFileCount: number;
    usedEvidenceCount: number;
    evidenceUsed: ViRepoEvidenceItemV1[];
  };
  learning: {
    learnedFactsCount: number;
    learnedFacts: Array<{ at: string; fact: string; anchors: string[] }>;
  };
  passive: {
    pendingCount: number;
    lastBackgroundActivityAt: string | null;
    /** Prior turn’s stored passive strength (0..1); influences gap threshold this turn. */
    priorPassiveProcessingStrength: number;
    effectivePassiveGapThresholdMs: number;
    pendingMention:
      | {
          capability: string;
          reasonCode: string;
          elapsedSinceLastUserMs: number;
          thresholdMs: number;
          evidenceCount: number;
        }
      | null;
  };
  recall: {
    messages: Array<{ role: "system"; content: string }>;
  };
};

export type ChatResponse = {
  reply: string;
  sessionId: string;
  /** Optional runtime provider notice (e.g. temporary fallback used). */
  providerNotice?: string;
  chronos?: ChatTurnChronos;
  /** Last computed internal temporal state for this turn (traceability). */
  temporalState?: ViTemporalInternalStateV1;
  /** Optional dev/debug trace for temporal state -> decision policy. */
  decisionTrace?: ViDecisionTraceV1;
  /** Repo-grounding provenance for this turn (actual retrieved evidence only). */
  evidenceUsed?: ViRepoEvidenceItemV1[];
  /** Unified internal state authority snapshot for this turn (debug/provenance). */
  unifiedState?: ViUnifiedStateV1;
};

export type ChatErrorResponse = {
  error: {
    message: string;
    code?: "UPSTREAM_QUOTA_LIMIT" | "UPSTREAM_RATE_LIMIT" | "INTERNAL_ERROR" | "SIGNUP_REQUIRED";
  };
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  /** Present when loaded from GET /chat/messages (Postgres `created_at`). */
  createdAt?: string;
};

export type ChatSessionMessagesResponse = {
  sessionId: string;
  messages: ChatHistoryMessage[];
};
