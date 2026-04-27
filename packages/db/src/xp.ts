import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "./client.js";
import { userXp } from "./schema.js";

/** XP required to reach level N (0-indexed). MEE6-style formula. */
export function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Cumulative XP required to reach level N from 0. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let n = 0; n < level; n++) total += xpForLevel(n);
  return total;
}

/** Compute level info from total XP. */
export function computeLevel(totalXp: number): {
  level: number;
  /** XP the current level started at */
  currentLevelStartXp: number;
  /** XP the next level starts at */
  nextLevelStartXp: number;
  /** XP progress within the current level */
  progressXp: number;
  /** XP needed to complete the current level */
  xpToNext: number;
} {
  let level = 0;
  let cumulative = 0;
  while (cumulative + xpForLevel(level) <= totalXp) {
    cumulative += xpForLevel(level);
    level++;
  }
  const nextLevelStartXp = cumulative + xpForLevel(level);
  return {
    level,
    currentLevelStartXp: cumulative,
    nextLevelStartXp,
    progressXp: totalXp - cumulative,
    xpToNext: nextLevelStartXp - totalXp,
  };
}

export type XpRow = {
  guildId: string;
  userId: string;
  xp: number;
  messageCount: number;
  lastMessageAt: number | null;
};

export type XpAddResult = {
  added: boolean;
  newXp: number;
  newMessageCount: number;
  level: number;
  leveledUp: boolean;
  /** 0 when no level change; can be >1 on large XP grants. */
  levelsGained: number;
};

/**
 * Accrue XP for a user in a guild, respecting the per-user cooldown.
 * Returns whether XP was actually added and the resulting totals.
 */
export async function addXpIfCooldownPassed(
  guildId: string,
  userId: string,
  xpAmount: number,
  cooldownMs: number,
): Promise<XpAddResult> {
  const nowMs = Date.now();
  const existing = await db
    .select()
    .from(userXp)
    .where(and(eq(userXp.guildId, guildId), eq(userXp.userId, userId)))
    .limit(1);

  const row = existing[0] ?? null;

  if (row && row.lastMessageAt != null && nowMs - row.lastMessageAt < cooldownMs) {
    const { level } = computeLevel(row.xp);
    return {
      added: false,
      newXp: row.xp,
      newMessageCount: row.messageCount,
      level,
      leveledUp: false,
      levelsGained: 0,
    };
  }

  const oldLevel = row ? computeLevel(row.xp).level : 0;

  const result = await db
    .insert(userXp)
    .values({
      guildId,
      userId,
      xp: xpAmount,
      messageCount: 1,
      lastMessageAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [userXp.guildId, userXp.userId],
      set: {
        xp: sql`user_xp.xp + ${xpAmount}`,
        messageCount: sql`user_xp.message_count + 1`,
        lastMessageAt: nowMs,
      },
    })
    .returning();

  const updated = result[0];
  const newXp = updated.xp;
  const { level: newLevel } = computeLevel(newXp);
  const levelsGained = Math.max(0, newLevel - oldLevel);

  return {
    added: true,
    newXp,
    newMessageCount: updated.messageCount,
    level: newLevel,
    leveledUp: newLevel > oldLevel,
    levelsGained,
  };
}

export type XpRankRow = XpRow & {
  rank: number;
  level: number;
  /** How many users have an XP row in this guild (denominator for percentile). */
  rankedMemberCount: number;
  /** XP still needed to strictly exceed the next person above (null if no one is strictly higher). */
  xpToOvertakeNext: number | null;
};

/** Count users with an XP row in a guild. */
export async function countGuildRankedMembers(guildId: string): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(userXp)
    .where(eq(userXp.guildId, guildId));
  return r[0]?.c ?? 0;
}

/** Get a user's XP, level, and guild rank (1-indexed). */
export async function getXpRank(guildId: string, userId: string): Promise<XpRankRow | null> {
  const row = await db
    .select()
    .from(userXp)
    .where(and(eq(userXp.guildId, guildId), eq(userXp.userId, userId)))
    .limit(1);

  if (!row[0]) return null;

  const [rankResult, countResult, higher] = await Promise.all([
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(userXp)
      .where(and(eq(userXp.guildId, guildId), gt(userXp.xp, row[0].xp))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(userXp)
      .where(eq(userXp.guildId, guildId)),
    db
      .select({ xp: userXp.xp })
      .from(userXp)
      .where(and(eq(userXp.guildId, guildId), gt(userXp.xp, row[0].xp)))
      .orderBy(asc(userXp.xp))
      .limit(1),
  ]);

  const rank = (rankResult[0]?.cnt ?? 0) + 1;
  const { level } = computeLevel(row[0].xp);
  const rankedMemberCount = countResult[0]?.c ?? 0;
  const xpToOvertakeNext =
    higher[0] != null ? Math.max(0, higher[0].xp - row[0].xp) : null;

  return { ...row[0], rank, level, rankedMemberCount, xpToOvertakeNext };
}

export type LeaderboardEntry = {
  userId: string;
  xp: number;
  messageCount: number;
  level: number;
  rank: number;
};

/** Get the top N users by XP in a guild. */
/**
 * Staff/owner adjustment: apply delta to total XP (floors at 0). Does not touch messageCount.
 * Creates a row if missing (xp was 0 and delta positive, or insert with 0 then update).
 */
export async function modifyXpByDelta(
  guildId: string,
  userId: string,
  deltaXp: number,
): Promise<{
  previousXp: number;
  newXp: number;
  levelBefore: number;
  levelAfter: number;
}> {
  const d = Math.trunc(deltaXp);
  if (!Number.isFinite(d) || d === 0) {
    throw new Error("deltaXp must be a non-zero finite integer");
  }
  if (Math.abs(d) > 1_000_000) {
    throw new Error("deltaXp absolute value too large (max 1_000_000)");
  }

  const existing = await db
    .select()
    .from(userXp)
    .where(and(eq(userXp.guildId, guildId), eq(userXp.userId, userId)))
    .limit(1);
  const prevRow = existing[0] ?? null;
  const previousXp = prevRow?.xp ?? 0;
  const newXp = Math.max(0, previousXp + d);
  const levelBefore = computeLevel(previousXp).level;
  const levelAfter = computeLevel(newXp).level;
  const nowMs = Date.now();

  if (!prevRow) {
    await db.insert(userXp).values({
      guildId,
      userId,
      xp: newXp,
      messageCount: 0,
      lastMessageAt: nowMs,
    });
  } else {
    await db
      .update(userXp)
      .set({ xp: newXp, lastMessageAt: nowMs })
      .where(and(eq(userXp.guildId, guildId), eq(userXp.userId, userId)));
  }

  return { previousXp, newXp, levelBefore, levelAfter };
}

export async function getXpLeaderboard(guildId: string, limit = 10): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select()
    .from(userXp)
    .where(eq(userXp.guildId, guildId))
    .orderBy(desc(userXp.xp))
    .limit(Math.min(limit, 50));

  return rows.map((r, i) => ({
    userId: r.userId,
    xp: r.xp,
    messageCount: r.messageCount,
    level: computeLevel(r.xp).level,
    rank: i + 1,
  }));
}
