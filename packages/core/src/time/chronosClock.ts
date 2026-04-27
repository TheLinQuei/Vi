/**
 * B2 — single authoritative wall clock for Chronos (pattern from legacy timeService).
 * All duration and "now" derivations for internal state should use this boundary.
 */
export type AuthoritativeTime = {
  utc: string;
  epochMs: number;
};

export function getAuthoritativeTime(): AuthoritativeTime {
  const now = new Date();
  return {
    utc: now.toISOString(),
    epochMs: now.getTime(),
  };
}
