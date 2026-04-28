import { and, asc, count, desc, eq, ilike, inArray, isNull, lte, notInArray, or } from "drizzle-orm";

import { db } from "./client.js";
import { authIdentities, messages, sessions, turnJournal, userContinuity, users, webSessions } from "./schema.js";

export type TurnJournalPhase =
  | "received"
  | "user_saved"
  | "model_done"
  | "assistant_saved"
  | "state_saved"
  | "idle_scan"
  | "idle_reflection_enqueued"
  | "failed";
export type TurnJournalStatus = "in_progress" | "completed" | "failed";

export async function getOrCreateUserByExternalId(externalId: string): Promise<{
  id: string;
  externalId: string;
}> {
  const found = await db
    .select({ id: users.id, externalId: users.externalId })
    .from(users)
    .where(eq(users.externalId, externalId))
    .limit(1);

  if (found[0]) return found[0];

  const inserted = await db
    .insert(users)
    .values({ externalId })
    .returning({ id: users.id, externalId: users.externalId });

  return inserted[0];
}

export async function findUserById(userId: string): Promise<{ id: string; externalId: string } | null> {
  const rows = await db
    .select({ id: users.id, externalId: users.externalId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAuthIdentityByProviderUserId(input: {
  provider: string;
  providerUserId: string;
}): Promise<{ id: string; userId: string; email: string | null; passwordHash: string | null } | null> {
  const rows = await db
    .select({
      id: authIdentities.id,
      userId: authIdentities.userId,
      email: authIdentities.email,
      passwordHash: authIdentities.passwordHash,
    })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, input.provider), eq(authIdentities.providerUserId, input.providerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAuthIdentityByProviderEmail(input: {
  provider: string;
  email: string;
}): Promise<{ id: string; userId: string; email: string | null; passwordHash: string | null } | null> {
  const rows = await db
    .select({
      id: authIdentities.id,
      userId: authIdentities.userId,
      email: authIdentities.email,
      passwordHash: authIdentities.passwordHash,
    })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, input.provider), eq(authIdentities.email, input.email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAuthIdentity(input: {
  userId: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
  passwordHash?: string | null;
}): Promise<{ id: string; userId: string }> {
  const rows = await db
    .insert(authIdentities)
    .values({
      userId: input.userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      email: input.email ?? null,
      passwordHash: input.passwordHash ?? null,
    })
    .returning({ id: authIdentities.id, userId: authIdentities.userId });
  return rows[0];
}

export async function findAuthEmailByUserId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: authIdentities.email })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), inArray(authIdentities.provider, ["email", "google"])))
    .orderBy(desc(authIdentities.createdAt))
    .limit(5);
  for (const row of rows) {
    if (row.email?.trim()) return row.email.trim().toLowerCase();
  }
  return null;
}

export async function createWebSession(input: {
  userId: string;
  sessionTokenHash: string;
  expiresAt: Date;
}): Promise<{ id: string; userId: string; expiresAt: Date }> {
  const rows = await db
    .insert(webSessions)
    .values({
      userId: input.userId,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
    })
    .returning({ id: webSessions.id, userId: webSessions.userId, expiresAt: webSessions.expiresAt });
  return rows[0];
}

export async function findWebSessionByTokenHash(sessionTokenHash: string): Promise<{
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
} | null> {
  const now = new Date();
  const rows = await db
    .select({
      id: webSessions.id,
      userId: webSessions.userId,
      expiresAt: webSessions.expiresAt,
      revokedAt: webSessions.revokedAt,
    })
    .from(webSessions)
    .where(
      and(
        eq(webSessions.sessionTokenHash, sessionTokenHash),
        isNull(webSessions.revokedAt),
        lte(now, webSessions.expiresAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeWebSessionByTokenHash(sessionTokenHash: string): Promise<void> {
  await db
    .update(webSessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(webSessions.sessionTokenHash, sessionTokenHash), isNull(webSessions.revokedAt)));
}

export async function getSessionForUser(
  sessionId: string,
  userId: string,
): Promise<{ id: string; userId: string } | null> {
  const found = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  return found[0] ?? null;
}

export async function createSession(userId: string): Promise<{ id: string; userId: string }> {
  const inserted = await db
    .insert(sessions)
    .values({ userId })
    .returning({ id: sessions.id, userId: sessions.userId });

  return inserted[0];
}

export async function listSessionsForUser(
  userId: string,
  limit: number,
): Promise<Array<{ id: string; updatedAt: Date }>> {
  const rows = await db
    .select({ id: sessions.id, updatedAt: sessions.updatedAt })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.updatedAt))
    .limit(limit);
  return rows;
}

export async function deleteSessionForUser(sessionId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function createMessage(input: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
}): Promise<{ id: string; createdAt: Date }> {
  const inserted = await db
    .insert(messages)
    .values({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      model: input.model ?? null,
    })
    .returning({ id: messages.id, createdAt: messages.createdAt });

  return inserted[0];
}

export async function createTurnJournal(input: {
  sessionId: string;
  phase: TurnJournalPhase;
  status: TurnJournalStatus;
  wallNowUtcIso: string;
  wallNowEpochMs: number;
}): Promise<{ id: string }> {
  const rows = await db
    .insert(turnJournal)
    .values({
      sessionId: input.sessionId,
      phase: input.phase,
      status: input.status,
      wallNowUtcIso: input.wallNowUtcIso,
      wallNowEpochMs: input.wallNowEpochMs,
    })
    .returning({ id: turnJournal.id });
  return rows[0];
}

export async function updateTurnJournal(input: {
  turnId: string;
  phase: TurnJournalPhase;
  status: TurnJournalStatus;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await db
    .update(turnJournal)
    .set({
      phase: input.phase,
      status: input.status,
      userMessageId: input.userMessageId ?? null,
      assistantMessageId: input.assistantMessageId ?? null,
      errorMessage: input.errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(turnJournal.id, input.turnId));
}

export async function listRecentTurnJournalForSession(
  sessionId: string,
  limit: number,
): Promise<
  Array<{
    phase: string;
    status: string;
    wallNowUtcIso: string;
    errorMessage: string | null;
    createdAt: Date;
  }>
> {
  const rows = await db
    .select({
      phase: turnJournal.phase,
      status: turnJournal.status,
      wallNowUtcIso: turnJournal.wallNowUtcIso,
      errorMessage: turnJournal.errorMessage,
      createdAt: turnJournal.createdAt,
    })
    .from(turnJournal)
    .where(eq(turnJournal.sessionId, sessionId))
    .orderBy(desc(turnJournal.createdAt))
    .limit(limit);
  return rows;
}

export async function createUserMessageAndMarkTurn(input: {
  turnId: string;
  sessionId: string;
  content: string;
}): Promise<{ id: string; createdAt: Date }> {
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        sessionId: input.sessionId,
        role: "user",
        content: input.content,
      })
      .returning({ id: messages.id, createdAt: messages.createdAt });
    const userRow = inserted[0];
    await tx
      .update(turnJournal)
      .set({
        phase: "user_saved",
        status: "in_progress",
        userMessageId: userRow.id,
        updatedAt: new Date(),
      })
      .where(eq(turnJournal.id, input.turnId));
    return userRow;
  });
}

export async function createAssistantMessageAndMarkTurn(input: {
  turnId: string;
  sessionId: string;
  content: string;
  model: string;
  finalPhase: TurnJournalPhase;
}): Promise<{ id: string; createdAt: Date }> {
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        sessionId: input.sessionId,
        role: "assistant",
        content: input.content,
        model: input.model,
      })
      .returning({ id: messages.id, createdAt: messages.createdAt });
    const assistantRow = inserted[0];
    await tx
      .update(turnJournal)
      .set({
        phase: input.finalPhase,
        status: "completed",
        assistantMessageId: assistantRow.id,
        updatedAt: new Date(),
      })
      .where(eq(turnJournal.id, input.turnId));
    return assistantRow;
  });
}

/** Latest user/assistant row in the session (by wall time). */
export async function getLatestUserOrAssistantMessageCreatedAt(
  sessionId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(eq(messages.sessionId, sessionId), inArray(messages.role, ["user", "assistant"])),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return rows[0]?.createdAt ?? null;
}

/** Latest user row in the session (by wall time). */
export async function getLatestUserMessageCreatedAt(
  sessionId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "user")))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return rows[0]?.createdAt ?? null;
}

/** Earliest user/assistant row in the session (thread start anchor). */
export async function getFirstUserOrAssistantMessageCreatedAt(
  sessionId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(eq(messages.sessionId, sessionId), inArray(messages.role, ["user", "assistant"])),
    )
    .orderBy(asc(messages.createdAt))
    .limit(1);

  return rows[0]?.createdAt ?? null;
}

export async function listRecentMessages(
  sessionId: string,
  limit: number,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows
    .reverse()
    .filter((row): row is { role: "user" | "assistant"; content: string } =>
      row.role === "user" || row.role === "assistant",
    );
}

const MAX_SESSION_MESSAGES_LOAD = 5000;

/** Full thread for a session, oldest → newest (UI hydration). */
export async function listSessionMessagesChronological(
  sessionId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string; createdAt: Date }>> {
  const rows = await db
    .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .limit(MAX_SESSION_MESSAGES_LOAD);

  return rows.filter(
    (row): row is { role: "user" | "assistant"; content: string; createdAt: Date } =>
      row.role === "user" || row.role === "assistant",
  );
}

export async function countSessionMessages(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));
  return Number(row?.n ?? 0);
}

/** Persisted Chronos v2 + discovery sidecars (North Star §5 / §8). */
export type SessionNorthStarRow = {
  id: string;
  createdAt: Date;
  lastInteractionEpochMs: number | null;
  totalSessionWallMs: number;
  lastGapDurationMs: number;
  perceivedWeight: number;
  drift: number;
  passiveProcessingStrength: number;
  discoveryQueueJson: string | null;
  learnedFactsJson: string | null;
  relationalStateJson: string | null;
  capabilityMilestonesJson: string | null;
};

export type UserContinuityRow = {
  userId: string;
  globalStateJson: string | null;
  idleActivityJson: string | null;
  repoDigestsJson: string | null;
  proposalQueueJson: string | null;
  lastRepoScanAt: Date | null;
  lastRepoFingerprint: string | null;
  updatedAt: Date;
};

export async function getSessionNorthStarRow(sessionId: string): Promise<SessionNorthStarRow | null> {
  const [row] = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastInteractionEpochMs: sessions.lastInteractionEpochMs,
      totalSessionWallMs: sessions.totalSessionWallMs,
      lastGapDurationMs: sessions.lastGapDurationMs,
      perceivedWeight: sessions.perceivedWeight,
      drift: sessions.drift,
      passiveProcessingStrength: sessions.passiveProcessingStrength,
      discoveryQueueJson: sessions.discoveryQueueJson,
      learnedFactsJson: sessions.learnedFactsJson,
      relationalStateJson: sessions.relationalStateJson,
      capabilityMilestonesJson: sessions.capabilityMilestonesJson,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    createdAt: row.createdAt,
    lastInteractionEpochMs: row.lastInteractionEpochMs ?? null,
    totalSessionWallMs: Number(row.totalSessionWallMs),
    lastGapDurationMs: Number(row.lastGapDurationMs),
    perceivedWeight: row.perceivedWeight,
    drift: row.drift,
    passiveProcessingStrength: row.passiveProcessingStrength,
    discoveryQueueJson: row.discoveryQueueJson,
    learnedFactsJson: row.learnedFactsJson,
    relationalStateJson: row.relationalStateJson,
    capabilityMilestonesJson: row.capabilityMilestonesJson,
  };
}

export async function updateSessionNorthStarPersistence(input: {
  sessionId: string;
  lastInteractionEpochMs: number;
  totalSessionWallMs: number;
  lastGapDurationMs: number;
  perceivedWeight: number;
  drift: number;
  passiveProcessingStrength: number;
  discoveryQueueJson: string | null;
  learnedFactsJson: string | null;
  relationalStateJson: string | null;
  capabilityMilestonesJson: string | null;
}): Promise<void> {
  await db
    .update(sessions)
    .set({
      lastInteractionEpochMs: input.lastInteractionEpochMs,
      totalSessionWallMs: input.totalSessionWallMs,
      lastGapDurationMs: input.lastGapDurationMs,
      perceivedWeight: input.perceivedWeight,
      drift: input.drift,
      passiveProcessingStrength: input.passiveProcessingStrength,
      discoveryQueueJson: input.discoveryQueueJson,
      learnedFactsJson: input.learnedFactsJson,
      relationalStateJson: input.relationalStateJson,
      capabilityMilestonesJson: input.capabilityMilestonesJson,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, input.sessionId));
}

export async function getSessionRollingSummaryFields(sessionId: string): Promise<{
  rollingSummary: string | null;
  summaryMessageCount: number;
} | null> {
  const [row] = await db
    .select({
      rollingSummary: sessions.rollingSummary,
      summaryMessageCount: sessions.summaryMessageCount,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return row ?? null;
}

export async function listCandidateSessionsForIdleScan(input: {
  activeWithinHours: number;
  limit: number;
}): Promise<Array<{ id: string; updatedAt: Date }>> {
  const floor = new Date(Date.now() - input.activeWithinHours * 60 * 60 * 1000);
  const rows = await db
    .select({ id: sessions.id, updatedAt: sessions.updatedAt })
    .from(sessions)
    .orderBy(desc(sessions.updatedAt))
    .limit(input.limit);
  return rows.filter((r) => r.updatedAt >= floor);
}

export async function listCandidateUsersForIdleScan(input: {
  activeWithinHours: number;
  limit: number;
}): Promise<Array<{ userId: string; updatedAt: Date }>> {
  const floor = new Date(Date.now() - input.activeWithinHours * 60 * 60 * 1000);
  const rows = await db
    .select({ userId: sessions.userId, updatedAt: sessions.updatedAt })
    .from(sessions)
    .orderBy(desc(sessions.updatedAt))
    .limit(input.limit * 4);
  const out: Array<{ userId: string; updatedAt: Date }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.updatedAt < floor) continue;
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push({ userId: r.userId, updatedAt: r.updatedAt });
    if (out.length >= input.limit) break;
  }
  return out;
}

export async function getUserContinuityRow(userId: string): Promise<UserContinuityRow | null> {
  const [row] = await db
    .select({
      userId: userContinuity.userId,
      globalStateJson: userContinuity.globalStateJson,
      idleActivityJson: userContinuity.idleActivityJson,
      repoDigestsJson: userContinuity.repoDigestsJson,
      proposalQueueJson: userContinuity.proposalQueueJson,
      lastRepoScanAt: userContinuity.lastRepoScanAt,
      lastRepoFingerprint: userContinuity.lastRepoFingerprint,
      updatedAt: userContinuity.updatedAt,
    })
    .from(userContinuity)
    .where(eq(userContinuity.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertUserContinuityRow(input: {
  userId: string;
  globalStateJson: string | null;
  idleActivityJson: string | null;
  repoDigestsJson: string | null;
  proposalQueueJson: string | null;
  lastRepoScanAt: Date | null;
  lastRepoFingerprint: string | null;
}): Promise<void> {
  const existing = await getUserContinuityRow(input.userId);
  if (!existing) {
    await db.insert(userContinuity).values({
      userId: input.userId,
      globalStateJson: input.globalStateJson,
      idleActivityJson: input.idleActivityJson,
      repoDigestsJson: input.repoDigestsJson,
      proposalQueueJson: input.proposalQueueJson,
      lastRepoScanAt: input.lastRepoScanAt,
      lastRepoFingerprint: input.lastRepoFingerprint,
    });
    return;
  }
  await db
    .update(userContinuity)
    .set({
      globalStateJson: input.globalStateJson,
      idleActivityJson: input.idleActivityJson,
      repoDigestsJson: input.repoDigestsJson,
      proposalQueueJson: input.proposalQueueJson,
      lastRepoScanAt: input.lastRepoScanAt,
      lastRepoFingerprint: input.lastRepoFingerprint,
      updatedAt: new Date(),
    })
    .where(eq(userContinuity.userId, input.userId));
}

export async function updateSessionRollingSummary(
  sessionId: string,
  rollingSummary: string,
  summaryMessageCount: number,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      rollingSummary,
      summaryMessageCount,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

/** Newest-first ids (e.g. exclude from archive search). */
export async function listRecentMessageIdsForSession(
  sessionId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.map((r) => r.id);
}

/** Keep ILIKE patterns safe: drop %/_ wildcards and very long fragments. */
function sanitizeTokenForIlike(token: string): string {
  return token.replace(/%/g, "").replace(/_/g, "").slice(0, 96).trim();
}

const ARCHIVE_SEARCH_SCAN_LIMIT = 400;

/**
 * Keyword match on user/assistant rows outside excluded ids.
 * Returns rows with a simple token-hit score (stronger = more distinct tokens matched).
 */
export async function searchSessionMessageArchive(
  sessionId: string,
  excludeIds: string[],
  tokens: string[],
  maxResults: number,
): Promise<Array<{ role: "user" | "assistant"; content: string; score: number }>> {
  const usable = tokens
    .map((t) => sanitizeTokenForIlike(t))
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (usable.length === 0) return [];

  const tokenPatterns = usable.map((t) => ilike(messages.content, `%${t}%`));

  const whereParts = [
    eq(messages.sessionId, sessionId),
    inArray(messages.role, ["user", "assistant"]),
    or(...tokenPatterns),
  ];
  if (excludeIds.length > 0) {
    whereParts.push(notInArray(messages.id, excludeIds));
  }

  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
    })
    .from(messages)
    .where(and(...whereParts))
    .orderBy(desc(messages.createdAt))
    .limit(ARCHIVE_SEARCH_SCAN_LIMIT);

  const filtered = rows.filter(
    (row): row is { role: "user" | "assistant"; content: string } =>
      row.role === "user" || row.role === "assistant",
  );

  const lowerContent = (s: string) => s.toLowerCase();
  const scored = filtered.map((row) => {
    const lc = lowerContent(row.content);
    let score = 0;
    for (const t of usable) {
      if (lc.includes(t.toLowerCase())) score += 1;
    }
    const phrase = usable.join(" ").toLowerCase();
    if (phrase.length >= 4 && lc.includes(phrase)) score += 2;
    return { ...row, score };
  });

  scored.sort((a, b) => b.score - a.score || b.content.length - a.content.length);
  const seen = new Set<string>();
  const out: Array<{ role: "user" | "assistant"; content: string; score: number }> = [];
  for (const row of scored) {
    const key = `${row.role}:${row.content.slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= maxResults) break;
  }
  return out;
}
