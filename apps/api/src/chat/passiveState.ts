import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTemporalContextSystemMessage } from "@vi/core/time/temporalContext";
import type { SessionNorthStarRow } from "@vi/db";
import type {
  ViDecisionTraceV1,
  ViRepoEvidenceDebugV1,
  ViRepoEvidenceItemV1,
  ViTemporalInternalStateV1,
  ViUnifiedStateV1,
} from "@vi/shared";

export type ShareIntent = "silent" | "mention_if_relevant";

export type PendingReflection = {
  id: string;
  capability: string;
  createdAt: string;
  reasonCode: "long_gap_time_awareness_check";
  elapsedSinceLastUserMs: number;
  thresholdMs: number;
  evidenceCount: number;
  shareIntent: ShareIntent;
  surfacedAt: string | null;
};

export type PassiveSessionState = {
  lastBackgroundActivityAt: string | null;
  pendingReflections: PendingReflection[];
  lastTemporalState: ViTemporalInternalStateV1 | null;
  lastDecisionTrace: ViDecisionTraceV1 | null;
  lastRepoEvidence: ViRepoEvidenceDebugV1 | null;
  learnedFacts: Array<{ at: string; fact: string; anchors: string[] }>;
  lastUnifiedState: ViUnifiedStateV1 | null;
};

export type MemoryTierV1 = "discard" | "archive_candidate" | "active";

const passiveStateBySession = new Map<string, PassiveSessionState>();

export function getRepoRoot(): string {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  /** `apps/api/src/chat` → workspace root (vi) */
  return path.resolve(srcDir, "../../../..");
}

export async function probeFileEvidence(
  repoRoot: string,
  relPath: string,
  mustContain: string[],
): Promise<{ path: string; found: string[]; missing: string[] }> {
  try {
    const full = path.join(repoRoot, relPath);
    const content = await readFile(full, "utf8");
    const found = mustContain.filter((needle) => content.includes(needle));
    const missing = mustContain.filter((needle) => !content.includes(needle));
    return { path: relPath, found, missing };
  } catch {
    return { path: relPath, found: [], missing: mustContain };
  }
}

export type TimeAwarenessEvidenceResponse = {
  capabilityId: "cap-time-awareness";
  generatedAt: string;
  runtime: {
    apiPort: number;
    userTimezone: string | null;
  };
  files: Array<{
    path: string;
    found: string[];
    missing: string[];
  }>;
  sampleTemporalBlock: string;
};

export async function buildTimeAwarenessEvidenceResponse(input: {
  apiPort: number;
  userTimezone: string | undefined;
  sampleWallNow: Date;
}): Promise<TimeAwarenessEvidenceResponse> {
  const repoRoot = getRepoRoot();
  const files = await Promise.all([
    probeFileEvidence(repoRoot, "packages/core/src/time/temporalContext.ts", [
      "buildTemporalContextSystemMessage",
      "Elapsed since that message:",
      "Local-style read",
    ]),
    probeFileEvidence(repoRoot, "apps/api/src/server.ts", [
      "buildTemporalContextSystemMessage",
      "chronos:",
      "userMessageAt",
      "assistantMessageAt",
    ]),
    probeFileEvidence(repoRoot, "packages/shared/src/types.ts", ["ChatTurnChronos", "createdAt?: string"]),
  ]);

  const sampleTemporalBlock = buildTemporalContextSystemMessage({
    now: input.sampleWallNow,
    previousTurnAt: new Date(input.sampleWallNow.getTime() - 90 * 60 * 1000),
    displayTimeZone: input.userTimezone,
  });

  return {
    capabilityId: "cap-time-awareness",
    generatedAt: new Date().toISOString(),
    runtime: {
      apiPort: input.apiPort,
      userTimezone: input.userTimezone ?? null,
    },
    files,
    sampleTemporalBlock,
  };
}

export function parseDiscoveryQueueJson(json: string | null | undefined): PendingReflection[] {
  if (!json) return [];
  try {
    const q = JSON.parse(json) as unknown;
    return Array.isArray(q) ? (q.slice(0, 8) as PendingReflection[]) : [];
  } catch {
    return [];
  }
}

export function parseLearnedFactsJson(
  json: string | null | undefined,
): Array<{ at: string; fact: string; anchors: string[] }> {
  if (!json) return [];
  try {
    const f = JSON.parse(json) as unknown;
    return Array.isArray(f) ? (f.slice(0, 20) as Array<{ at: string; fact: string; anchors: string[] }>) : [];
  } catch {
    return [];
  }
}

export function hydratePassiveFromNorthStarRow(row: SessionNorthStarRow, passive: PassiveSessionState): void {
  // DB is authoritative every turn; do not preserve stale cache values.
  passive.pendingReflections = parseDiscoveryQueueJson(row.discoveryQueueJson);
  passive.learnedFacts = parseLearnedFactsJson(row.learnedFactsJson);
}

export function getPassiveStateIfLoaded(sessionId: string): PassiveSessionState | undefined {
  return passiveStateBySession.get(sessionId);
}

export function getPassiveState(sessionId: string): PassiveSessionState {
  const existing = passiveStateBySession.get(sessionId);
  if (existing) return existing;
  const fresh: PassiveSessionState = {
    lastBackgroundActivityAt: null,
    pendingReflections: [],
    lastTemporalState: null,
    lastDecisionTrace: null,
    lastRepoEvidence: null,
    learnedFacts: [],
    lastUnifiedState: null,
  };
  passiveStateBySession.set(sessionId, fresh);
  return fresh;
}

export function deletePassiveStateForSession(sessionId: string): void {
  passiveStateBySession.delete(sessionId);
}

export function isRelevantForPendingMention(userMessage: string): boolean {
  const m = userMessage.toLowerCase();
  return (
    /\bhow are you\b/.test(m) ||
    /\bwhat are you thinking\b/.test(m) ||
    /\bwhat changed\b/.test(m) ||
    /\bwhat are you up to\b/.test(m) ||
    /\btime\b/.test(m) ||
    /\bmemory\b/.test(m) ||
    /\bvision\b/.test(m)
  );
}

export function maybePersistAnchoredLearning(input: {
  passive: PassiveSessionState;
  reply: string;
  evidenceUsed: ViRepoEvidenceItemV1[];
}): void {
  const anchors = input.evidenceUsed.map((e) => e.filePath).filter((p) => p.length > 0);
  if (anchors.length === 0) return;
  const fact = input.reply.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!fact) return;
  const retention = scoreMemoryRetentionV1({
    fact,
    anchors,
    source: "model_reply_with_evidence",
  });
  if (retention.tier === "discard") return;
  input.passive.learnedFacts = [
    {
      at: new Date().toISOString(),
      fact,
      anchors: [
        ...anchors,
        `memory_tier:${retention.tier}`,
        `memory_score:${retention.score.toFixed(2)}`,
      ],
    },
    ...input.passive.learnedFacts,
  ].slice(0, 20);
}

export function scoreMemoryRetentionV1(input: {
  fact: string;
  anchors: string[];
  source: "model_reply_with_evidence" | "conflict_update" | "override_forced";
}): { score: number; tier: MemoryTierV1 } {
  const text = input.fact.toLowerCase();
  let score = 0.25;
  if (input.anchors.length >= 2) score += 0.2;
  if (input.anchors.some((a) => a.includes("override:forced"))) score += 0.5;
  if (input.anchors.some((a) => a.includes("memory_conflict:update"))) score += 0.45;
  if (input.anchors.some((a) => a.includes("memory_conflict:clarify"))) score += 0.3;
  if (/\b(continuity|identity|boundary|override|loyalty|memory|chronos)\b/.test(text)) score += 0.2;
  if (input.source === "conflict_update") score += 0.2;
  if (input.source === "override_forced") score += 0.2;
  if (text.length < 24) score -= 0.15;
  // Conflict traces are contractual memory integrity artifacts; never discard them.
  if (input.source === "conflict_update") score = Math.max(score, 0.72);
  score = Math.min(1, Math.max(0, score));

  if (score < 0.5) return { score, tier: "discard" };
  if (score < 0.72) return { score, tier: "archive_candidate" };
  return { score, tier: "active" };
}

type ConflictResolutionOutcome = "none" | "clarify" | "updated";

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function extractUserClaim(message: string): { key: string; value: string } | null {
  const m = message.trim();
  const claimPatterns: Array<{ re: RegExp; key: string }> = [
    { re: /my\s+favorite\s+color\s+is\s+([^.!?\n]+)/i, key: "favorite color" },
    { re: /my\s+name\s+is\s+([^.!?\n]+)/i, key: "name" },
    { re: /i\s+live\s+in\s+([^.!?\n]+)/i, key: "location" },
    { re: /i\s+work\s+at\s+([^.!?\n]+)/i, key: "workplace" },
  ];
  for (const p of claimPatterns) {
    const hit = m.match(p.re);
    if (!hit) continue;
    const value = hit[1].trim().replace(/\s+/g, " ");
    if (!value) continue;
    return { key: p.key, value };
  }
  return null;
}

function looksLikeCorrection(message: string): boolean {
  return /\b(actually|no,|no\.|correction|i changed|that changed|not\s+\w+\s+anymore|used to)\b/i.test(
    message,
  );
}

/**
 * C3 conflict policy (deterministic):
 * - detect simple user-claim facts
 * - if conflicting with active fact on same key:
 *   - correction signal => update as explicit evolution (replace prior conflicting active fact)
 *   - else => add clarify marker so response path can challenge/clarify
 */
export function applyMemoryConflictResolution(input: {
  passive: PassiveSessionState;
  userMessage: string;
}): ConflictResolutionOutcome {
  const claim = extractUserClaim(input.userMessage);
  if (!claim) return "none";
  const keyNorm = normalizeText(claim.key);
  const valueNorm = normalizeText(claim.value);
  const now = new Date().toISOString();
  const correction = looksLikeCorrection(input.userMessage);

  let conflictingPrior: string | null = null;
  const retained: Array<{ at: string; fact: string; anchors: string[] }> = [];
  for (const f of input.passive.learnedFacts) {
    const factNorm = normalizeText(f.fact);
    const sameKey = factNorm.includes(keyNorm);
    const sameValue = factNorm.includes(valueNorm);
    if (sameKey && !sameValue && conflictingPrior === null) {
      conflictingPrior = f.fact;
      if (!correction) retained.push(f);
      continue;
    }
    retained.push(f);
  }

  if (!conflictingPrior) {
    const fact = `User-stated profile fact: ${claim.key} ${claim.value}`.trim();
    const anchors = ["memory_conflict:user_claim"];
    const retention = scoreMemoryRetentionV1({ fact, anchors, source: "conflict_update" });
    if (retention.tier === "discard") return "none";
    input.passive.learnedFacts = [
      {
        at: now,
        fact,
        anchors: [...anchors, `memory_tier:${retention.tier}`, `memory_score:${retention.score.toFixed(2)}`],
      },
      ...retained,
    ].slice(0, 20);
    return "none";
  }

  if (!correction) {
    const fact = `PENDING_CLARIFY conflict on "${claim.key}": prior="${conflictingPrior}" new="${claim.value}"`;
    const anchors = ["memory_conflict:clarify"];
    const retention = scoreMemoryRetentionV1({ fact, anchors, source: "conflict_update" });
    if (retention.tier === "discard") return "clarify";
    input.passive.learnedFacts = [
      {
        at: now,
        fact,
        anchors: [...anchors, `memory_tier:${retention.tier}`, `memory_score:${retention.score.toFixed(2)}`],
      },
      ...retained,
    ].slice(0, 20);
    return "clarify";
  }

  const fact = `EVOLUTION_UPDATE ${claim.key} ${claim.value} (supersedes: ${conflictingPrior})`;
  const anchors = ["memory_conflict:update"];
  const retention = scoreMemoryRetentionV1({ fact, anchors, source: "conflict_update" });
  if (retention.tier !== "discard") {
    input.passive.learnedFacts = [
      {
        at: now,
        fact,
        anchors: [...anchors, `memory_tier:${retention.tier}`, `memory_score:${retention.score.toFixed(2)}`],
      },
      ...retained.filter((f) => !normalizeText(f.fact).includes("pending clarify conflict on")),
    ].slice(0, 20);
  } else {
    input.passive.learnedFacts = retained.filter(
      (f) => !normalizeText(f.fact).includes("pending clarify conflict on"),
    );
  }
  return "updated";
}

/**
 * When the gap since the last user message exceeds the passive threshold, enqueue a bounded
 * time-awareness reflection (deterministic evidence probe + queue entry).
 */
export async function maybeEnqueueLongGapTimeAwarenessReflection(input: {
  passive: PassiveSessionState;
  wallNow: Date;
  previousUserMessageAt: Date | null;
  passiveThresholdMs: number;
  apiPort: number;
  userTimezone: string | undefined;
}): Promise<void> {
  if (!input.previousUserMessageAt) return;

  const elapsedMs = input.wallNow.getTime() - input.previousUserMessageAt.getTime();
  if (elapsedMs < input.passiveThresholdMs) return;

  const evidence = await buildTimeAwarenessEvidenceResponse({
    apiPort: input.apiPort,
    userTimezone: input.userTimezone,
    sampleWallNow: input.wallNow,
  });

  const foundCount = evidence.files.reduce((n, f) => n + f.found.length, 0);
  const reflection: PendingReflection = {
    id: `${evidence.capabilityId}-${Date.now()}`,
    capability: "Time awareness grounding",
    createdAt: new Date().toISOString(),
    reasonCode: "long_gap_time_awareness_check",
    elapsedSinceLastUserMs: elapsedMs,
    thresholdMs: input.passiveThresholdMs,
    evidenceCount: foundCount,
    shareIntent: "silent",
    surfacedAt: null,
  };
  input.passive.pendingReflections = [reflection, ...input.passive.pendingReflections].slice(0, 8);
  input.passive.lastBackgroundActivityAt = reflection.createdAt;
}
