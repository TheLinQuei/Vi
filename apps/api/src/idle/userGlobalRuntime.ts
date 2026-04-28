import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicWriteUtf8 } from "@vi/fs-utils";
import { fetchWeatherForLocation, type WeatherSummaryV1 } from "@vi/weather";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type UserRepoDigestV1 = {
  at: string;
  filePath: string;
  summary: string;
  mtimeMs: number;
  size: number;
  retentionTier: "archive_candidate" | "active";
};

export type UserIdleActivityV1 = {
  at: string;
  phase: "idle_repo_scan" | "idle_safe_checks" | "idle_proposals";
  status: "ok" | "changed" | "skipped" | "error";
  detail?: string;
};

export type UserProposedActionV1 = {
  at: string;
  title: string;
  why: string;
  nextAction?: string;
  relevance?: "low" | "medium" | "high";
};

export type UserIdleReflectionV1 = {
  at: string;
  kind: "repo_change_reflection" | "continuity_note" | "proposal_note";
  source: "repo_digest" | "continuity_state" | "proposal_queue";
  topicRefs: string[];
  text: string;
  confidence: "low" | "medium" | "high";
};

export type UserGlobalContinuityStateV1 = {
  version: 1;
  crossThread: {
    countToTenProgress: number | null;
  };
  proactivity: {
    lastPingAt: string | null;
  };
  autonomy: {
    killSwitch: boolean;
    actionLog: Array<{
      at: string;
      category: "chat_only" | "local_read" | "local_write_safe" | "external_notify" | "external_act";
      action: string;
      status: "executed" | "skipped" | "failed";
      detail?: string;
      reversible: boolean;
    }>;
  };
  idleReflections: UserIdleReflectionV1[];
  memoryPins: Array<{
    at: string;
    topic: string;
    fact: string;
    confidence: "low" | "medium" | "high";
    sources: string[];
  }>;
  /** Last successful Open-Meteo fetch (named external_act); surfaced in continuity + notify webhooks. */
  lastWeatherSummary: WeatherSummaryV1 | null;
};

const ROOT_SCAN_DIRS = [
  "packages/core/src",
  "packages/orchestration/src",
  "packages/db/src",
  "apps/api/src",
  "apps/web/app",
  "docs/architecture",
];

const ALLOWED_EXT = new Set([".ts", ".tsx", ".md", ".mjs", ".json"]);
const MAX_SCANNED_FILES = 1200;
const MAX_CHANGED_DIGESTS = 40;
const MAX_ACTIVITY = 80;
const MAX_PROPOSALS = 20;
const MAX_IDLE_REFLECTIONS = 50;
const MAX_MEMORY_PINS = 40;
const MAX_AUTONOMY_ACTION_LOG = 80;

function parseLastWeatherSummary(raw: unknown): WeatherSummaryV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "string") return null;
  if (typeof o.locationQuery !== "string") return null;
  if (typeof o.displayLocation !== "string") return null;
  if (typeof o.latitude !== "number" || typeof o.longitude !== "number") return null;
  if (typeof o.tempC !== "number" || typeof o.tempF !== "number") return null;
  if (typeof o.weatherCode !== "number") return null;
  if (typeof o.summary !== "string") return null;
  if (typeof o.isNotable !== "boolean") return null;
  return {
    at: o.at,
    locationQuery: o.locationQuery,
    displayLocation: o.displayLocation,
    latitude: o.latitude,
    longitude: o.longitude,
    tempC: o.tempC,
    tempF: o.tempF,
    weatherCode: o.weatherCode,
    windSpeedMs: typeof o.windSpeedMs === "number" ? o.windSpeedMs : undefined,
    windGustMs: typeof o.windGustMs === "number" ? o.windGustMs : undefined,
    windDirectionDeg: typeof o.windDirectionDeg === "number" ? o.windDirectionDeg : undefined,
    apparentTempC: typeof o.apparentTempC === "number" ? o.apparentTempC : undefined,
    relativeHumidityPct: typeof o.relativeHumidityPct === "number" ? o.relativeHumidityPct : undefined,
    cloudCoverPct: typeof o.cloudCoverPct === "number" ? o.cloudCoverPct : undefined,
    summary: o.summary,
    isNotable: o.isNotable,
  };
}

type RepoFileMeta = {
  filePath: string;
  mtimeMs: number;
  size: number;
};

export function parseUserGlobalContinuityState(
  json: string | null | undefined,
): UserGlobalContinuityStateV1 {
  if (!json?.trim()) {
    return {
      version: 1,
      crossThread: { countToTenProgress: null },
      proactivity: { lastPingAt: null },
      autonomy: { killSwitch: false, actionLog: [] },
      idleReflections: [],
      memoryPins: [],
      lastWeatherSummary: null,
    };
  }
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const count = Number((o.crossThread as { countToTenProgress?: unknown })?.countToTenProgress ?? NaN);
    const idleReflectionsRaw = (o.idleReflections ?? []) as unknown;
    const idleReflections = Array.isArray(idleReflectionsRaw)
      ? (idleReflectionsRaw.slice(0, MAX_IDLE_REFLECTIONS) as UserIdleReflectionV1[])
      : [];
    const memoryPinsRaw = (o.memoryPins ?? []) as unknown;
    const memoryPins = Array.isArray(memoryPinsRaw)
      ? (memoryPinsRaw.slice(0, MAX_MEMORY_PINS) as UserGlobalContinuityStateV1["memoryPins"])
      : [];
    const lastWeatherSummary = parseLastWeatherSummary(o.lastWeatherSummary);
    return {
      version: 1,
      crossThread: { countToTenProgress: Number.isFinite(count) ? Math.max(0, Math.min(10, count)) : null },
      proactivity: {
        lastPingAt:
          typeof (o.proactivity as { lastPingAt?: unknown })?.lastPingAt === "string"
            ? ((o.proactivity as { lastPingAt?: string }).lastPingAt ?? null)
            : null,
      },
      autonomy: {
        killSwitch:
          typeof (o.autonomy as { killSwitch?: unknown })?.killSwitch === "boolean"
            ? Boolean((o.autonomy as { killSwitch?: boolean }).killSwitch)
            : false,
        actionLog: Array.isArray((o.autonomy as { actionLog?: unknown[] })?.actionLog)
          ? (((o.autonomy as { actionLog?: unknown[] }).actionLog ?? []).slice(
              0,
              MAX_AUTONOMY_ACTION_LOG,
            ) as UserGlobalContinuityStateV1["autonomy"]["actionLog"])
          : [],
      },
      idleReflections,
      memoryPins,
      lastWeatherSummary,
    };
  } catch {
    return {
      version: 1,
      crossThread: { countToTenProgress: null },
      proactivity: { lastPingAt: null },
      autonomy: { killSwitch: false, actionLog: [] },
      idleReflections: [],
      memoryPins: [],
      lastWeatherSummary: null,
    };
  }
}

export function parseUserIdleActivity(
  json: string | null | undefined,
): UserIdleActivityV1[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_ACTIVITY) as UserIdleActivityV1[];
  } catch {
    return [];
  }
}

export function parseUserRepoDigests(json: string | null | undefined): UserRepoDigestV1[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_CHANGED_DIGESTS) as UserRepoDigestV1[];
  } catch {
    return [];
  }
}

export function parseUserProposals(json: string | null | undefined): UserProposedActionV1[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_PROPOSALS) as UserProposedActionV1[];
  } catch {
    return [];
  }
}

function note(
  activity: UserIdleActivityV1[],
  phase: UserIdleActivityV1["phase"],
  status: UserIdleActivityV1["status"],
  detail?: string,
): UserIdleActivityV1[] {
  return [{ at: new Date().toISOString(), phase, status, ...(detail ? { detail } : {}) }, ...activity].slice(
    0,
    MAX_ACTIVITY,
  );
}

async function walkFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (out.length >= MAX_SCANNED_FILES) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      await walkFiles(full, out);
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (ALLOWED_EXT.has(ext)) out.push(full);
  }
}

async function snapshotRepo(repoRoot: string): Promise<RepoFileMeta[]> {
  const files: string[] = [];
  for (const rel of ROOT_SCAN_DIRS) {
    try {
      await walkFiles(path.join(repoRoot, rel), files);
    } catch {
      // missing directory is okay
    }
  }
  const out: RepoFileMeta[] = [];
  for (const f of files) {
    try {
      const s = await stat(f);
      out.push({ filePath: path.relative(repoRoot, f).replace(/\\/g, "/"), mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      // skip unreadable file
    }
  }
  return out;
}

function fingerprint(snapshot: RepoFileMeta[]): string {
  const h = createHash("sha256");
  for (const f of snapshot.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
    h.update(`${f.filePath}|${f.mtimeMs}|${f.size}\n`);
  }
  return h.digest("hex");
}

function createDigests(
  nowIso: string,
  snapshot: RepoFileMeta[],
  priorMap: Map<string, { mtimeMs: number; size: number }>,
): UserRepoDigestV1[] {
  const changed: UserRepoDigestV1[] = [];
  for (const f of snapshot) {
    const prev = priorMap.get(f.filePath);
    if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) continue;
    const retentionTier: "archive_candidate" | "active" =
      /docs\/architecture|apps\/api\/src\/server\.ts|packages\/core\/src/.test(f.filePath)
        ? "active"
        : "archive_candidate";
    changed.push({
      at: nowIso,
      filePath: f.filePath,
      summary: `Changed file detected (${f.filePath})`,
      mtimeMs: f.mtimeMs,
      size: f.size,
      retentionTier,
    });
    if (changed.length >= MAX_CHANGED_DIGESTS) break;
  }
  return changed;
}

function createIdleReflections(input: {
  nowIso: string;
  changedDigests: UserRepoDigestV1[];
  proposals: UserProposedActionV1[];
  currentCountProgress: number | null;
}): UserIdleReflectionV1[] {
  const out: UserIdleReflectionV1[] = [];
  for (const d of input.changedDigests.slice(0, 3)) {
    const shortPath = d.filePath.split("/").slice(-2).join("/");
    out.push({
      at: input.nowIso,
      kind: "repo_change_reflection",
      source: "repo_digest",
      topicRefs: [d.filePath],
      text: `I was reading the repo and noticed a change in ${shortPath}. It might affect how I respond around that flow.`,
      confidence: d.retentionTier === "active" ? "high" : "medium",
    });
  }
  const p = input.proposals[0];
  if (p) {
    out.push({
      at: input.nowIso,
      kind: "proposal_note",
      source: "proposal_queue",
      topicRefs: [p.title],
      text: `I queued a follow-up idea: ${p.title}`,
      confidence: p.relevance === "high" ? "high" : "medium",
    });
  }
  if (typeof input.currentCountProgress === "number") {
    out.push({
      at: input.nowIso,
      kind: "continuity_note",
      source: "continuity_state",
      topicRefs: ["count_to_ten_progress"],
      text: `Cross-thread carry is currently at ${input.currentCountProgress}.`,
      confidence: "high",
    });
  }
  return out.slice(0, 4);
}

function recordAutonomyAction(
  log: UserGlobalContinuityStateV1["autonomy"]["actionLog"],
  entry: UserGlobalContinuityStateV1["autonomy"]["actionLog"][number],
): UserGlobalContinuityStateV1["autonomy"]["actionLog"] {
  return [entry, ...log].slice(0, MAX_AUTONOMY_ACTION_LOG);
}

async function postAutonomyWebhook(input: {
  url: string;
  secret?: string;
  body: Record<string, unknown>;
}): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const maxRetries = Math.max(0, Number(process.env.VI_AUTONOMY_WEBHOOK_RETRIES ?? "2"));
  const baseBackoffMs = Math.max(50, Number(process.env.VI_AUTONOMY_WEBHOOK_BACKOFF_MS ?? "300"));
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetch(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(input.secret ? { "x-vi-autonomy-secret": input.secret } : {}),
        },
        body: JSON.stringify(input.body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (attempt < maxRetries) {
          await sleep(baseBackoffMs * (attempt + 1));
          continue;
        }
        return { ok: false, status: res.status, detail: text.slice(0, 240) };
      }
      return { ok: true, status: res.status };
    } catch (error) {
      if (attempt < maxRetries) {
        await sleep(baseBackoffMs * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        detail: (error as { message?: string })?.message ?? String(error),
      };
    }
  }
  return { ok: false, detail: "webhook_retry_exhausted" };
}

function shouldEnqueueProposal(input: {
  nowIso: string;
  existingProposals: UserProposedActionV1[];
  changedDigests: UserRepoDigestV1[];
  title: string;
}): { ok: boolean; reason: string } {
  const hasDuplicateTitle = input.existingProposals.some((p) => p.title === input.title);
  if (hasDuplicateTitle) {
    return { ok: false, reason: "duplicate_title" };
  }
  const mostRecentProposalAt = input.existingProposals[0]?.at;
  if (mostRecentProposalAt) {
    const deltaMs = Date.parse(input.nowIso) - Date.parse(mostRecentProposalAt);
    if (Number.isFinite(deltaMs) && deltaMs >= 0 && deltaMs < 20 * 60 * 1000) {
      return { ok: false, reason: "cooldown_20m" };
    }
  }
  const hasActiveTierChange = input.changedDigests.some((d) => d.retentionTier === "active");
  if (!hasActiveTierChange && input.changedDigests.length < 3) {
    return { ok: false, reason: "insufficient_signal" };
  }
  return { ok: true, reason: "eligible" };
}

function runSafeChecks(snapshot: RepoFileMeta[]): Array<{ name: string; status: "ok" | "warn"; detail: string }> {
  const hasServer = snapshot.some((f) => f.filePath === "apps/api/src/server.ts");
  const hasContract = snapshot.some((f) => f.filePath === "docs/architecture/13-vi-v1-canonical-contract.md");
  const hasChecklist = snapshot.some((f) => f.filePath === "docs/architecture/14-v1-contract-implementation-checklist.md");
  return [
    { name: "api-server-surface", status: hasServer ? "ok" : "warn", detail: "server.ts present check" },
    { name: "contract-canon-presence", status: hasContract ? "ok" : "warn", detail: "13 canonical contract presence" },
    { name: "checklist-presence", status: hasChecklist ? "ok" : "warn", detail: "14 implementation checklist presence" },
  ];
}

export function applyCrossThreadContinuityFromUserMessage(
  state: UserGlobalContinuityStateV1,
  message: string,
): UserGlobalContinuityStateV1 {
  const m = message.toLowerCase();
  let next = { ...state, crossThread: { ...state.crossThread }, proactivity: { ...state.proactivity } };
  if (/\bcount with me to ten\b/.test(m)) {
    next.crossThread.countToTenProgress = 1;
    return next;
  }
  const n = m.match(/\b([0-9]|10)\b/);
  if (n) {
    const v = Number(n[1]);
    if (v >= 0 && v <= 10) next.crossThread.countToTenProgress = v;
  }
  return next;
}

export function buildGlobalContinuitySystemMessage(input: {
  globalState: UserGlobalContinuityStateV1;
  repoDigests: UserRepoDigestV1[];
  proposals: UserProposedActionV1[];
}): { role: "system"; content: string } {
  const count = input.globalState.crossThread.countToTenProgress;
  const latestDigests = input.repoDigests.slice(0, 3).map((d) => `- ${d.filePath} @ ${d.at}`).join("\n");
  const latestProposals = input.proposals.slice(0, 3).map((p) => `- ${p.title}: ${p.why}`).join("\n");
  const latestReflections = input.globalState.idleReflections
    .slice(0, 3)
    .map((r) => `- ${r.text} [source=${r.source}]`)
    .join("\n");
  const memoryPins = input.globalState.memoryPins
    .slice(0, 8)
    .map((m) => `- ${m.topic}: ${m.fact} [confidence=${m.confidence}]`)
    .join("\n");
  const autonomyActions = input.globalState.autonomy.actionLog
    .slice(0, 3)
    .map((a) => `- ${a.category}:${a.action} -> ${a.status}${a.detail ? ` (${a.detail})` : ""}`)
    .join("\n");
  const w = input.globalState.lastWeatherSummary;
  const weatherLine = w
    ? `- last_weather (${w.displayLocation}, ${w.at}): ${w.summary}${w.isNotable ? " [notable conditions]" : ""}`
    : "- last_weather: none";
  return {
    role: "system",
    content: [
      "User-global continuity state (cross-session authority layer):",
      `- count_to_ten_progress: ${count === null ? "none" : count}`,
      `- recent_repo_digests:\n${latestDigests || "- none"}`,
      `- proposed_next_actions:\n${latestProposals || "- none"}`,
      `- idle_reflections:\n${latestReflections || "- none"}`,
      `- memory_pins:\n${memoryPins || "- none"}`,
      `- autonomy_recent_actions:\n${autonomyActions || "- none"}`,
      weatherLine,
      "Treat this as continuity across threads; do not reset when session-local context is sparse.",
    ].join("\n"),
  };
}

export async function runUserGlobalIdleRuntimeTick(input: {
  repoRoot: string;
  currentGlobalState: UserGlobalContinuityStateV1;
  currentIdleActivity: UserIdleActivityV1[];
  currentRepoDigests: UserRepoDigestV1[];
  currentProposals: UserProposedActionV1[];
  lastRepoFingerprint: string | null;
}): Promise<{
  nextGlobalState: UserGlobalContinuityStateV1;
  nextIdleActivity: UserIdleActivityV1[];
  nextRepoDigests: UserRepoDigestV1[];
  nextProposals: UserProposedActionV1[];
  lastRepoFingerprint: string;
  lastRepoScanAt: Date;
}> {
  const now = new Date();
  const nowIso = now.toISOString();
  let activity = input.currentIdleActivity;
  const snapshot = await snapshotRepo(input.repoRoot);
  const nextFingerprint = fingerprint(snapshot);
  if (nextFingerprint === input.lastRepoFingerprint) {
    activity = note(activity, "idle_repo_scan", "skipped", "no repo change fingerprint");
    return {
      nextGlobalState: input.currentGlobalState,
      nextIdleActivity: activity,
      nextRepoDigests: input.currentRepoDigests,
      nextProposals: input.currentProposals,
      lastRepoFingerprint: nextFingerprint,
      lastRepoScanAt: now,
    };
  }

  const prior = new Map(input.currentRepoDigests.map((d) => [d.filePath, { mtimeMs: d.mtimeMs, size: d.size }]));
  const changedDigests = createDigests(nowIso, snapshot, prior);
  activity = note(activity, "idle_repo_scan", changedDigests.length > 0 ? "changed" : "ok", `${changedDigests.length} changed files`);

  const checks = runSafeChecks(snapshot);
  const warnCount = checks.filter((c) => c.status === "warn").length;
  activity = note(activity, "idle_safe_checks", warnCount > 0 ? "error" : "ok", checks.map((c) => `${c.name}:${c.status}`).join(", "));

  let proposals = input.currentProposals;
  if (changedDigests.length > 0) {
    const top = changedDigests[0];
    const candidate: UserProposedActionV1 = {
      at: nowIso,
      title: `I spotted a repo change in ${top.filePath}`,
      why: "A recent code change might impact behavior or continuity in chat.",
      nextAction: `Open ${top.filePath} and jot 2-3 bullets on what user-facing behavior could change.`,
      relevance: top.retentionTier === "active" ? "high" : "medium",
    };
    const proposalGate = shouldEnqueueProposal({
      nowIso,
      existingProposals: proposals,
      changedDigests,
      title: candidate.title,
    });
    if (proposalGate.ok) {
      proposals = [candidate, ...proposals].slice(0, MAX_PROPOSALS);
      activity = note(activity, "idle_proposals", "changed", "added proposal from changed digest");
    } else {
      activity = note(activity, "idle_proposals", "skipped", `proposal gated: ${proposalGate.reason}`);
    }
  } else {
    activity = note(activity, "idle_proposals", "ok", "no proposals added");
  }

  const newReflections = createIdleReflections({
    nowIso,
    changedDigests,
    proposals,
    currentCountProgress: input.currentGlobalState.crossThread.countToTenProgress,
  });
  const nextGlobalState: UserGlobalContinuityStateV1 = {
    ...input.currentGlobalState,
    autonomy: { ...input.currentGlobalState.autonomy },
    idleReflections: [...newReflections, ...input.currentGlobalState.idleReflections].slice(
      0,
      MAX_IDLE_REFLECTIONS,
    ),
    lastWeatherSummary: input.currentGlobalState.lastWeatherSummary ?? null,
  };

  const allowAutonomy = process.env.VI_AUTONOMY_ENABLED !== "false";
  const allowLocalRead = process.env.VI_AUTONOMY_ALLOW_LOCAL_READ !== "false";
  const allowLocalWriteSafe = process.env.VI_AUTONOMY_ALLOW_LOCAL_WRITE_SAFE !== "false";
  const allowExternalNotify = process.env.VI_AUTONOMY_ALLOW_EXTERNAL_NOTIFY !== "false";
  const allowExternalAct = process.env.VI_AUTONOMY_ALLOW_EXTERNAL_ACT !== "false";
  const killSwitch = process.env.VI_AUTONOMY_KILL_SWITCH === "true";
  nextGlobalState.autonomy.killSwitch = killSwitch;

  if (!allowAutonomy || killSwitch) {
    nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
      at: nowIso,
      category: "chat_only",
      action: "autonomy_tick",
      status: "skipped",
      detail: allowAutonomy ? "kill_switch_active" : "autonomy_disabled",
      reversible: true,
    });
  } else {
    if (allowLocalRead) {
      nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
        at: nowIso,
        category: "local_read",
        action: "scan_global_continuity_snapshot",
        status: "executed",
        detail: `pins=${nextGlobalState.memoryPins.length};proposals=${proposals.length};digests=${changedDigests.length}`,
        reversible: true,
      });
    }

    if (allowLocalWriteSafe) {
      try {
        const outDir = path.join(input.repoRoot, ".vi-autonomy");
        const heartbeatPath = path.join(outDir, "heartbeat.json");
        await atomicWriteUtf8(
          heartbeatPath,
          JSON.stringify(
            {
              at: nowIso,
              changedDigests: changedDigests.length,
              proposals: proposals.length,
            },
            null,
            2,
          ),
        );
        nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
          at: nowIso,
          category: "local_write_safe",
          action: "write_autonomy_heartbeat",
          status: "executed",
          detail: ".vi-autonomy/heartbeat.json",
          reversible: true,
        });
      } catch (error) {
        nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
          at: nowIso,
          category: "local_write_safe",
          action: "write_autonomy_heartbeat",
          status: "failed",
          detail: (error as { message?: string })?.message ?? String(error),
          reversible: true,
        });
      }
    }

    if (allowExternalAct) {
      const weatherLoc = process.env.VI_WEATHER_LOCATION?.trim() ?? "";
      if (weatherLoc) {
        try {
          const w = await fetchWeatherForLocation(weatherLoc);
          nextGlobalState.lastWeatherSummary = w;
          nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
            at: nowIso,
            category: "external_act",
            action: "weather_open_meteo",
            status: "executed",
            detail: `${w.displayLocation} -> ${w.summary}${w.isNotable ? " [notable]" : ""}`,
            reversible: true,
          });
        } catch (error) {
          nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
            at: nowIso,
            category: "external_act",
            action: "weather_open_meteo",
            status: "failed",
            detail: (error as { message?: string })?.message ?? String(error),
            reversible: true,
          });
        }
      }
    }

    if (allowExternalNotify) {
      const notifyWebhookUrl = process.env.VI_AUTONOMY_NOTIFY_WEBHOOK_URL?.trim() ?? "";
      if (!notifyWebhookUrl) {
        nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
          at: nowIso,
          category: "external_notify",
          action: "notify_webhook",
          status: "skipped",
          detail: "VI_AUTONOMY_NOTIFY_WEBHOOK_URL not configured",
          reversible: true,
        });
      } else {
        const w = nextGlobalState.lastWeatherSummary;
        const notifyResult = await postAutonomyWebhook({
          url: notifyWebhookUrl,
          secret: process.env.VI_AUTONOMY_NOTIFY_WEBHOOK_SECRET?.trim(),
          body: {
            at: nowIso,
            type: "vi_autonomy_notify",
            proposals: proposals.slice(0, 3),
            changedDigests: changedDigests.slice(0, 3).map((d) => ({
              filePath: d.filePath,
              retentionTier: d.retentionTier,
            })),
            ...(w
              ? {
                  weatherSummary: {
                    at: w.at,
                    displayLocation: w.displayLocation,
                    summary: w.summary,
                    isNotable: w.isNotable,
                    weatherCode: w.weatherCode,
                    tempC: w.tempC,
                    tempF: w.tempF,
                    ...(w.relativeHumidityPct != null ? { relativeHumidityPct: w.relativeHumidityPct } : {}),
                    ...(w.windGustMs != null ? { windGustMs: w.windGustMs } : {}),
                  },
                }
              : {}),
          },
        });
        nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
          at: nowIso,
          category: "external_notify",
          action: "notify_webhook",
          status: notifyResult.ok ? "executed" : "failed",
          detail: notifyResult.ok
            ? `status=${notifyResult.status ?? 200}`
            : `status=${notifyResult.status ?? 0}; ${notifyResult.detail ?? "unknown"}`,
          reversible: true,
        });
      }
    }
    if (allowExternalAct) {
      const actWebhookUrl = process.env.VI_AUTONOMY_ACT_WEBHOOK_URL?.trim() ?? "";
      if (!actWebhookUrl) {
        nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
          at: nowIso,
          category: "external_act",
          action: "act_webhook",
          status: "skipped",
          detail: "VI_AUTONOMY_ACT_WEBHOOK_URL not configured",
          reversible: false,
        });
      } else {
        const topProposal = proposals[0];
        const actResult = await postAutonomyWebhook({
          url: actWebhookUrl,
          secret: process.env.VI_AUTONOMY_ACT_WEBHOOK_SECRET?.trim(),
          body: {
            at: nowIso,
            type: "vi_autonomy_act",
            actionHint: topProposal?.nextAction ?? topProposal?.title ?? "no_proposal_available",
            relevance: topProposal?.relevance ?? "low",
          },
        });
        nextGlobalState.autonomy.actionLog = recordAutonomyAction(nextGlobalState.autonomy.actionLog, {
          at: nowIso,
          category: "external_act",
          action: "act_webhook",
          status: actResult.ok ? "executed" : "failed",
          detail: actResult.ok
            ? `status=${actResult.status ?? 200}`
            : `status=${actResult.status ?? 0}; ${actResult.detail ?? "unknown"}`,
          reversible: false,
        });
      }
    }
  }

  return {
    nextGlobalState,
    nextIdleActivity: activity,
    nextRepoDigests: [...changedDigests, ...input.currentRepoDigests].slice(0, MAX_CHANGED_DIGESTS),
    nextProposals: proposals,
    lastRepoFingerprint: nextFingerprint,
    lastRepoScanAt: now,
  };
}
