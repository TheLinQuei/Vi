import type { ViCapabilityMilestoneV1 } from "@vi/shared";

function isoNow(): string {
  return new Date().toISOString();
}

export function parseCapabilityMilestonesJson(
  json: string | null | undefined,
): ViCapabilityMilestoneV1[] {
  if (!json?.trim()) return [];
  try {
    const rows = JSON.parse(json) as unknown;
    return Array.isArray(rows) ? (rows as ViCapabilityMilestoneV1[]).slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function serializeCapabilityMilestonesJson(rows: ViCapabilityMilestoneV1[]): string {
  return JSON.stringify(rows.slice(0, 24));
}

/**
 * Ensure base capability history exists so Vi can reference upgrades over time.
 * Idempotent per milestone id.
 */
export function ensureBaselineCapabilityMilestones(
  rows: ViCapabilityMilestoneV1[],
): ViCapabilityMilestoneV1[] {
  const out = [...rows];
  const has = new Set(out.map((r) => r.id));
  const pushIfMissing = (m: ViCapabilityMilestoneV1) => {
    if (has.has(m.id)) return;
    out.unshift(m);
    has.add(m.id);
  };
  pushIfMissing({
    id: "ms-time-authority-v1",
    label: "Chronos authority live",
    evidence: "wall-clock now and temporal blocks are host-computed",
    recordedAt: isoNow(),
  });
  pushIfMissing({
    id: "ms-phase2-stance-v1",
    label: "Phase 2 interpretation+stance live",
    evidence: "evaluative turns derive stance before decision and enforce non-deflection",
    recordedAt: isoNow(),
  });
  return out.slice(0, 24);
}

export function buildCapabilityMilestonesSystemMessage(
  rows: ViCapabilityMilestoneV1[],
): string {
  if (rows.length === 0) return "";
  const lines = rows.slice(0, 6).map((m, i) => {
    return `[#${i + 1}] ${m.label}\n- id: ${m.id}\n- evidence: ${m.evidence}\n- recorded_at: ${m.recordedAt}`;
  });
  return [
    "Capability milestones (persistent change history; cite these when asked about before/after upgrades):",
    ...lines,
    "Rule: if asked about past capability state, reference milestone facts first; do not claim total memory of periods before recorded milestones.",
  ].join("\n");
}

