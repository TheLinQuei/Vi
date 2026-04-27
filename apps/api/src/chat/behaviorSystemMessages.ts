import { buildDecisionPolicySystemMessage } from "@vi/core/decision/temporalDecisionPolicy";
import { buildHumanityEngineSystemMessageV1 } from "@vi/core/humanity/humanityEngine";
import { buildRepoEvidenceSystemMessage } from "../repoEvidence.js";
import { buildTemporalContextSystemMessage } from "@vi/core/time/temporalContext";
import { buildTemporalInternalStateSystemMessage } from "@vi/core/time/temporalInternalState";
import {
  buildAlignedInterpretationSystemMessage,
  buildRelationalStateSystemMessage,
  buildStanceSystemMessage,
  buildUserIntentSystemMessage,
} from "@vi/core/phase2/phase2SystemMessages";
import { buildCapabilityMilestonesSystemMessage } from "@vi/core/phase2/capabilityMilestones";
import {
  applySystemMessageTokenBudget,
  resolveSystemMessageTokenBudget,
  type BudgetedSystemBlock,
} from "@vi/core/prompt/contextTokenBudget";
import type { ViUnifiedStateV1 } from "@vi/shared";

function buildLearnedFactsSystemMessage(learnedFacts: Array<{ at: string; fact: string; anchors: string[] }>): string {
  if (learnedFacts.length === 0) return "";
  const lines = learnedFacts
    .slice(0, 5)
    .map((f, i) => `[#${i + 1}] fact=${f.fact}\nanchors=${f.anchors.join(", ")}`);
  return [
    "Anchored learned facts (source-linked; use only as grounded context):",
    ...lines,
    "If facts conflict with current evidence, prefer current evidence and state uncertainty.",
  ].join("\n");
}

export function buildBehaviorSystemMessagesFromUnifiedState(input: {
  unifiedState: ViUnifiedStateV1;
  displayTimeZone?: string;
}): Array<{ role: "system"; content: string }> {
  const { unifiedState } = input;
  const temporalBlock = buildTemporalContextSystemMessage({
    now: new Date(unifiedState.authorityMeta.wallNowUtcIso),
    previousTurnAt: unifiedState.authorityMeta.previousTurnAtIso
      ? new Date(unifiedState.authorityMeta.previousTurnAtIso)
      : null,
    displayTimeZone: input.displayTimeZone,
  });
  const internalStateBlock = buildTemporalInternalStateSystemMessage(unifiedState.temporal);
  const userIntentBlock = buildUserIntentSystemMessage({
    userIntent: unifiedState.userIntent,
    effectiveResponseMode: unifiedState.effectiveResponseMode,
  });
  const interpretationBlock = buildAlignedInterpretationSystemMessage(unifiedState.alignedInterpretation);
  const stanceBlock = buildStanceSystemMessage(
    unifiedState.stance,
    unifiedState.effectiveResponseMode,
  );
  const relationalBlock = buildRelationalStateSystemMessage(unifiedState.relational);
  const humanityBlock = buildHumanityEngineSystemMessageV1({
    engine: unifiedState.humanity.engine,
    isPreferenceQuestion: unifiedState.humanity.interpretation.isPreferenceQuestion,
    activeTraitIds: unifiedState.humanity.interpretation.activeTraitIds,
    wantsIntent: unifiedState.humanity.interpretation.wantsIntent,
    responseMode: unifiedState.humanity.decision.responseMode,
    activationResponseMode: unifiedState.humanity.decision.activationResponseMode,
    stanceStrength: unifiedState.humanity.decision.stanceStrength,
    directness: unifiedState.humanity.expression.directness,
    warmth: unifiedState.humanity.expression.warmth,
    depth: unifiedState.humanity.expression.depth,
    posture: unifiedState.humanity.expression.posture,
    emotion: unifiedState.humanity.expression.emotion,
    actorRole: unifiedState.authorityMeta.actorRole,
  });
  const decisionPolicyBlock = buildDecisionPolicySystemMessage(unifiedState.decision);

  const repoEvidenceBlock =
    unifiedState.repo.usedEvidenceCount > 0
      ? [
          {
            role: "system" as const,
            content: buildRepoEvidenceSystemMessage({
              userMessage: unifiedState.repo.sourceQuestion,
              evidenceUsed: unifiedState.repo.evidenceUsed,
            }),
          },
        ]
      : [];

  const learnedFactsBlock = buildLearnedFactsSystemMessage(unifiedState.learning.learnedFacts);
  const learnedFactMessages = learnedFactsBlock
    ? ([{ role: "system" as const, content: learnedFactsBlock }] as const)
    : [];
  const milestonesBlock = buildCapabilityMilestonesSystemMessage(unifiedState.capabilityMilestones);
  const milestoneMessages = milestonesBlock
    ? ([{ role: "system" as const, content: milestonesBlock }] as const)
    : [];

  const pendingMentionBlock = unifiedState.passive.pendingMention
    ? ([
        {
          role: "system" as const,
          content:
            `Passive self-model metadata (brief mention only if natural):\n` +
            `- capability: ${unifiedState.passive.pendingMention.capability}\n` +
            `- reason_code: ${unifiedState.passive.pendingMention.reasonCode}\n` +
            `- elapsed_since_last_user_ms: ${unifiedState.passive.pendingMention.elapsedSinceLastUserMs}\n` +
            `- threshold_ms: ${unifiedState.passive.pendingMention.thresholdMs}\n` +
            `- evidence_count: ${unifiedState.passive.pendingMention.evidenceCount}\n` +
            `Rules: no fake emotions, no fixed canned sentence, one short line max unless user asks for details.`,
        },
      ] as const)
    : [];

  const budgeted: BudgetedSystemBlock[] = [
    { role: "system", content: temporalBlock, budgetPriority: 9 },
    { role: "system", content: internalStateBlock, budgetPriority: 6 },
    { role: "system", content: userIntentBlock, budgetPriority: 8 },
    { role: "system", content: interpretationBlock, budgetPriority: 8 },
    { role: "system", content: stanceBlock, budgetPriority: 8 },
    { role: "system", content: relationalBlock, budgetPriority: 10 },
    { role: "system", content: humanityBlock, budgetPriority: 10 },
    { role: "system", content: decisionPolicyBlock, budgetPriority: 6 },
    ...repoEvidenceBlock.map((m) => ({ ...m, budgetPriority: 6 })),
    ...learnedFactMessages.map((m) => ({ ...m, budgetPriority: 4 })),
    ...milestoneMessages.map((m) => ({ ...m, budgetPriority: 3 })),
    ...pendingMentionBlock.map((m) => ({ ...m, budgetPriority: 2 })),
    ...unifiedState.recall.messages.map((m) => ({ ...m, budgetPriority: 7 })),
  ];

  return applySystemMessageTokenBudget(budgeted, resolveSystemMessageTokenBudget());
}
