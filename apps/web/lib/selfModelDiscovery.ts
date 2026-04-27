export type DiscoveryStatus = "queued" | "reading" | "analyzed" | "reflected" | "approved";
export type DiscoveryPreference = "yes" | "not_yet" | "no";
export type DiscoveryConfidence = "low" | "medium" | "high";

export type Reflection = {
  capability: string;
  what_it_is: string;
  what_it_does: string;
  what_it_changes_for_vi: string;
  current_state: string;
  evidence: string[];
  risks: string[];
  prerequisites: string[];
  preference: DiscoveryPreference;
  reason: string;
  confidence: DiscoveryConfidence;
};

export type CapabilityPacket = {
  id: string;
  capability: string;
  status: DiscoveryStatus;
  evidenceFiles: string[];
  evidenceReadCount: number;
  evidenceDetails?: string[];
  reflection?: Reflection;
  lastUpdatedAt: string;
};

export type ActivityEntry = {
  at: string;
  kind: "status" | "reflection" | "approval";
  capabilityId: string;
  text: string;
};

export type DiscoveryState = {
  version: 2;
  queue: CapabilityPacket[];
  activity: ActivityEntry[];
};

export const SELF_MODEL_STORAGE_KEY = "vi.selfModel.v1";

function nowIso(): string {
  return new Date().toISOString();
}

function makePacket(id: string, capability: string, evidenceFiles: string[]): CapabilityPacket {
  return {
    id,
    capability,
    status: "queued",
    evidenceFiles,
    evidenceReadCount: 0,
    lastUpdatedAt: nowIso(),
  };
}

export function defaultDiscoveryState(): DiscoveryState {
  return {
    version: 2,
    queue: [
      makePacket(
        "cap-time-awareness",
        "Time awareness grounding",
        [
          "packages/core/src/time/temporalContext.ts",
          "apps/api/src/server.ts",
          "packages/shared/src/types.ts",
        ],
      ),
    ],
    activity: [],
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function loadDiscoveryState(): DiscoveryState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SELF_MODEL_STORAGE_KEY);
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isObj(parsed) || parsed.version !== 2 || !Array.isArray(parsed.queue) || !Array.isArray(parsed.activity)) {
      return null;
    }
    const state = parsed as DiscoveryState;
    const hasTimeAwareness = state.queue.some((q) => q.id === "cap-time-awareness");
    if (!hasTimeAwareness) return null;
    return state;
  } catch {
    return null;
  }
}

export function saveDiscoveryState(state: DiscoveryState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELF_MODEL_STORAGE_KEY, JSON.stringify(state));
}

function pushActivity(
  state: DiscoveryState,
  entry: Omit<ActivityEntry, "at">,
): DiscoveryState {
  return {
    ...state,
    activity: [{ ...entry, at: nowIso() }, ...state.activity].slice(0, 40),
  };
}

export function startNextCapability(state: DiscoveryState): DiscoveryState {
  const idx = state.queue.findIndex((q) => q.status === "queued");
  if (idx < 0) return state;
  const next = state.queue[idx];
  const queue = [...state.queue];
  queue[idx] = {
    ...next,
    status: "reading",
    evidenceReadCount: 0,
    lastUpdatedAt: nowIso(),
  };
  return pushActivity({ ...state, queue }, {
    kind: "status",
    capabilityId: next.id,
    text: `${next.capability}: queued -> reading`,
  });
}

export type TimeAwarenessEvidenceSnapshot = {
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

export function buildTimeAwarenessReflection(
  evidence: TimeAwarenessEvidenceSnapshot,
): Reflection {
  const missingCount = evidence.files.reduce((n, f) => n + f.missing.length, 0);
  const foundCount = evidence.files.reduce((n, f) => n + f.found.length, 0);
  const hasTimezone = Boolean(evidence.runtime.userTimezone);
  const confidence: DiscoveryConfidence = missingCount === 0 ? "high" : "medium";
  const currentState =
    missingCount === 0
      ? "Temporal context builder, API wiring, and shared Chronos types are present and connected."
      : "Temporal pipeline is partially wired; some expected anchors were not confirmed in bounded evidence checks.";

  return {
    capability: "Time awareness grounding",
    what_it_is:
      "A bounded Chronos pipeline that computes wall-time context and injects it into each chat turn.",
    what_it_does:
      "Lets Vi reference current time, elapsed gap, and thread timing using measurable timestamps instead of guesswork.",
    what_it_changes_for_vi:
      "Improves temporal truthfulness and makes time claims auditable through UI/POST metadata.",
    current_state: `${currentState} Runtime timezone configured: ${hasTimezone ? evidence.runtime.userTimezone : "none (UTC fallback)"}.`,
    evidence: evidence.files.map((f) => `${f.path} (found ${f.found.length}/${f.found.length + f.missing.length})`),
    risks: [
      "Without configured user timezone, local phrasing can default to UTC and feel wrong for the user.",
      "Rounding in language can still feel imprecise even when underlying timestamps are correct.",
    ],
    prerequisites: [
      "API must keep emitting chronos and message createdAt fields.",
      "Temporal prompt rules and eval checks must remain aligned with Chronos definitions.",
    ],
    preference: "yes",
    reason:
      `Bounded evidence confirms core temporal hooks (${foundCount} anchors found). This capability directly supports truthful continuity and verification.`,
    confidence,
  };
}

export function applyTimeAwarenessEvidence(
  state: DiscoveryState,
  evidence: TimeAwarenessEvidenceSnapshot,
): DiscoveryState {
  const idx = state.queue.findIndex((q) => q.id === "cap-time-awareness");
  if (idx < 0) return state;
  const current = state.queue[idx];
  if (current.status !== "reading") return state;
  const queue = [...state.queue];
  const evidenceDetails = [
    `Runtime API port: ${evidence.runtime.apiPort}`,
    `Runtime timezone: ${evidence.runtime.userTimezone ?? "unset (UTC fallback)"}`,
    ...evidence.files.map(
      (f) =>
        `${f.path}: found[${f.found.join(", ") || "none"}] missing[${f.missing.join(", ") || "none"}]`,
    ),
    `Temporal block sample: ${evidence.sampleTemporalBlock.split("\n")[0]}`,
  ];

  queue[idx] = {
    ...current,
    status: "analyzed",
    evidenceReadCount: current.evidenceFiles.length,
    evidenceDetails,
    reflection: buildTimeAwarenessReflection(evidence),
    lastUpdatedAt: nowIso(),
  };

  return pushActivity({ ...state, queue }, {
    kind: "status",
    capabilityId: current.id,
    text: `${current.capability}: reading -> analyzed (real evidence packet loaded)`,
  });
}

export function advanceCurrentCapability(state: DiscoveryState): DiscoveryState {
  const idx = state.queue.findIndex((q) => q.status === "reading" || q.status === "analyzed");
  if (idx < 0) return state;
  const current = state.queue[idx];
  const queue = [...state.queue];

  if (current.status === "reading") return state;

  queue[idx] = {
    ...current,
    status: "reflected",
    lastUpdatedAt: nowIso(),
  };
  return pushActivity(
    pushActivity({ ...state, queue }, {
      kind: "status",
      capabilityId: current.id,
      text: `${current.capability}: analyzed -> reflected`,
    }),
    {
      kind: "reflection",
      capabilityId: current.id,
      text: `${current.capability}: reflection drafted (${current.reflection?.preference ?? "not_yet"})`,
    },
  );
}

export function approveReflection(state: DiscoveryState, capabilityId: string): DiscoveryState {
  const idx = state.queue.findIndex((q) => q.id === capabilityId);
  if (idx < 0) return state;
  const current = state.queue[idx];
  if (current.status !== "reflected") return state;
  const queue = [...state.queue];
  queue[idx] = {
    ...current,
    status: "approved",
    lastUpdatedAt: nowIso(),
  };
  return pushActivity({ ...state, queue }, {
    kind: "approval",
    capabilityId,
    text: `${current.capability}: reflected -> approved`,
  });
}

export function currentCapability(state: DiscoveryState): CapabilityPacket | null {
  return (
    state.queue.find((q) => q.status === "reading" || q.status === "analyzed" || q.status === "reflected") ??
    null
  );
}

export function nextQueuedCapability(state: DiscoveryState): CapabilityPacket | null {
  return state.queue.find((q) => q.status === "queued") ?? null;
}

export function lastCompletedReflection(state: DiscoveryState): CapabilityPacket | null {
  const completed = state.queue.filter((q) => q.status === "reflected" || q.status === "approved");
  if (completed.length === 0) return null;
  return completed.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))[0] ?? null;
}
