const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

function clampNonNegative(ms: number): number {
  return ms < 0 ? 0 : ms;
}

function pctOfUnit(elapsedMs: number, unitMs: number): string {
  const p = (elapsedMs / unitMs) * 100;
  if (p < 0.05) return "under 0.1%";
  if (p < 10) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

function describeElapsed(elapsedMs: number): string {
  const m = Math.floor(elapsedMs / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 48) {
    const hPart = `${h} hour${h === 1 ? "" : "s"}`;
    return remM > 0 ? `${hPart} ${remM} minute${remM === 1 ? "" : "s"}` : hPart;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  const dPart = `${d} day${d === 1 ? "" : "s"}`;
  return remH > 0 ? `${dPart} ${remH} hour${remH === 1 ? "" : "s"}` : dPart;
}

function formatInstant(isoUtc: string, timeZone: string): string {
  try {
    const d = new Date(isoUtc);
    if (Number.isNaN(d.getTime())) {
      return isoUtc;
    }
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return isoUtc;
  }
}

export type TemporalContextInput = {
  now: Date;
  /** Latest user or assistant message in this thread before the current user turn, if any. */
  previousTurnAt: Date | null;
  /** IANA zone for local display, e.g. America/New_York. Invalid values fall back to UTC. */
  displayTimeZone?: string;
};

/**
 * System message: wall clock + elapsed silence with human-scale proportions (day/week).
 */
export function buildTemporalContextSystemMessage(input: TemporalContextInput): string {
  const tz = input.displayTimeZone?.trim() || "UTC";
  const now = input.now;
  const nowIso = now.toISOString();
  const localLine = `Local-style read (${tz}): ${formatInstant(nowIso, tz)}`;
  const utcLine = `Now (UTC, ISO): ${nowIso}`;
  const localFirst = tz !== "UTC";

  const header = "Current time context (factual; from the host environment):";
  const wallClockLines = localFirst
    ? [
        header,
        `- ${localLine}`,
        `- ${utcLine}`,
        "For plain 'what time is it?' questions, lead with the local-style read and name that timezone; add UTC only if they ask or it helps.",
      ]
    : [
        header,
        `- ${utcLine}`,
        `- ${localLine}`,
        "No dedicated user timezone is configured (local line is UTC). If they need local time, say you only have this clock unless they or the host set a zone.",
      ];

  if (!input.previousTurnAt) {
    return [
      ...wallClockLines,
      "No prior user/assistant message exists in this session yet—this turn starts the thread.",
    ].join("\n");
  }

  const elapsedMs = clampNonNegative(now.getTime() - input.previousTurnAt.getTime());
  const prevIso = input.previousTurnAt.toISOString();
  const dayFrac = pctOfUnit(elapsedMs, MS_DAY);
  const weekFrac = pctOfUnit(elapsedMs, MS_WEEK);

  return [
    ...wallClockLines,
    `- Previous user/assistant message in this thread (UTC, ISO): ${prevIso}`,
    `- Elapsed since that message: ${describeElapsed(elapsedMs)} (~${dayFrac} of a 24-hour day, ~${weekFrac} of a 7-day week).`,
    "Elapsed is wall-clock time between stored message timestamps in this thread, not a felt duration.",
  ].join("\n");
}
