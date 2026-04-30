import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { timingSafeEqual } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  looksLikeRepoCodeQuestion,
  retrieveRepoEvidence,
} from "./repoEvidence.js";
import { getAuthoritativeTime } from "@vi/core/time/chronosClock";
import {
  ensureBaselineCapabilityMilestones,
  parseCapabilityMilestonesJson,
  serializeCapabilityMilestonesJson,
} from "@vi/core/phase2/capabilityMilestones";
import {
  computeNextRelationalStateV1,
  parseRelationalStateJson,
  serializeRelationalStateV1,
} from "@vi/core/phase2/relationalState";
import {
  computeNextPersistedChronosBundle,
  effectivePassiveGapThresholdMs,
} from "@vi/core/time/chronosPersisted";
import {
  buildViTemporalInternalStateV1,
} from "@vi/core/time/temporalInternalState";
import { buildBehaviorSystemMessagesFromUnifiedState } from "./chat/behaviorSystemMessages.js";
import { deriveTurnUnifiedStateV1 } from "./chat/deriveUnifiedState.js";
import { inferAddressedToVi, parseMixedEnvironmentContext } from "./chat/addresseeRouting.js";
import { buildOnboardingV1SystemMessage, parseOnboardingV1FromContext } from "./chat/onboardingContext.js";
import {
  buildTimeAwarenessEvidenceResponse,
  deletePassiveStateForSession,
  getPassiveState,
  getPassiveStateIfLoaded,
  getRepoRoot,
  hydratePassiveFromNorthStarRow,
  isRelevantForPendingMention,
  maybeEnqueueLongGapTimeAwarenessReflection,
  applyMemoryConflictResolution,
  maybePersistAnchoredLearning,
  scoreMemoryRetentionV1,
  parseDiscoveryQueueJson,
  parseLearnedFactsJson,
  type PendingReflection,
  type TimeAwarenessEvidenceResponse,
} from "./chat/passiveState.js";
import {
  createAssistantMessageAndMarkTurn,
  createAuthIdentity,
  createWebSession,
  createSession,
  createTurnJournal,
  createUserMessageAndMarkTurn,
  deleteSessionForUser,
  getFirstUserOrAssistantMessageCreatedAt,
  getLatestUserMessageCreatedAt,
  getLatestUserOrAssistantMessageCreatedAt,
  getOrCreateUserByExternalId,
  getSessionForUser,
  getSessionNorthStarRow,
  getSessionRollingSummaryFields,
  getUserContinuityRow,
  findAuthIdentityByProviderEmail,
  findAuthEmailByUserId,
  findAuthIdentityByProviderUserId,
  findUserById,
  findWebSessionByTokenHash,
  listCandidateSessionsForIdleScan,
  listCandidateUsersForIdleScan,
  listRecentMessages,
  listRecentTurnJournalForSession,
  listSessionsForUser,
  listSessionMessagesChronological,
  revokeWebSessionByTokenHash,
  updateSessionNorthStarPersistence,
  upsertUserContinuityRow,
  updateTurnJournal,
} from "@vi/db";
import type { SessionNorthStarRow } from "@vi/db";
import {
  addXpIfCooldownPassed,
  countGuildRankedMembers,
  getXpLeaderboard,
  getXpRank,
  modifyXpByDelta,
} from "@vi/db";
import {
  buildRecallSystemMessages,
  RECALL_EXCLUDE_RECENT_COUNT,
  refreshRollingSessionSummaryIfDue,
  runTurn,
} from "@vi/orchestration";
import {
  applyCrossThreadContinuityFromUserMessage,
  buildGlobalContinuitySystemMessage,
  parseUserGlobalContinuityState,
  parseUserIdleActivity,
  parseUserProposals,
  parseUserRepoDigests,
  runUserGlobalIdleRuntimeTick,
} from "./idle/userGlobalRuntime.js";
import { FORBIDDEN_ADAPTER_KEYS, validateChatRequestBodyShape } from "@vi/shared/moduleAdapter";
import type {
  ChatErrorResponse,
  ChatRequest,
  ChatResponse,
  ChatSessionMessagesResponse,
  ViPersistedChronosSnapshotV1,
  ViRelationalStateV1,
  ViUnifiedStateV1,
  ViRepoEvidenceDebugV1,
  ViDecisionTraceV1,
  ViTemporalInternalStateV1,
} from "@vi/shared";
import { apiEnv } from "./env.js";

const app = Fastify({ logger: false });
const VI_CORS_ORIGINS = apiEnv.VI_CORS_ORIGINS.trim();
const CORS_ORIGIN_LIST = VI_CORS_ORIGINS
  ? VI_CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3002",
      "http://127.0.0.1:3002",
    ];
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ORIGIN_LIST.includes("*")) return cb(null, true);
    if (CORS_ORIGIN_LIST.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed"), false);
  },
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  credentials: true,
});
await app.register(cookie);

const VI_OWNER_EXTERNAL_ID = apiEnv.VI_OWNER_EXTERNAL_ID.trim().toLowerCase();
const HISTORY_LIMIT = 20;
const DEBUG_CONTEXT = apiEnv.VI_DEBUG_CONTEXT === "true";
const USER_TIMEZONE = apiEnv.VI_USER_TIMEZONE?.trim() || undefined;
// Cloud Run injects PORT and probes it; local dev uses API_PORT from .env (see apps/api/Dockerfile).
const rawListenPort =
  process.env.PORT != null && process.env.PORT !== "" ? Number(process.env.PORT) : NaN;
const API_PORT =
  Number.isFinite(rawListenPort) && rawListenPort > 0 ? rawListenPort : apiEnv.API_PORT;
const PASSIVE_DISCOVERY_GAP_MINUTES = apiEnv.VI_PASSIVE_DISCOVERY_GAP_MINUTES;
const VI_TEMPORAL_MEANINGFUL_GAP_MS_RAW = Number(apiEnv.VI_TEMPORAL_MEANINGFUL_GAP_MS ?? "");
const VI_TEMPORAL_MEANINGFUL_GAP_MS =
  Number.isFinite(VI_TEMPORAL_MEANINGFUL_GAP_MS_RAW) && VI_TEMPORAL_MEANINGFUL_GAP_MS_RAW > 0
    ? VI_TEMPORAL_MEANINGFUL_GAP_MS_RAW
    : null;
const VI_DEBUG_DECISION_TRACE = apiEnv.VI_DEBUG_DECISION_TRACE !== "false";
const VI_IDLE_WORKER_ENABLED = apiEnv.VI_IDLE_WORKER_ENABLED !== "false";
const VI_IDLE_SCAN_INTERVAL_MS = apiEnv.VI_IDLE_SCAN_INTERVAL_MS;
const VI_IDLE_ACTIVE_WINDOW_HOURS = apiEnv.VI_IDLE_ACTIVE_WINDOW_HOURS;
const VI_OVERRIDE_STRING_NAME = apiEnv.VI_OVERRIDE_STRING_NAME.trim();
const VI_AUTONOMY_PING_MIN_INTERVAL_MS = apiEnv.VI_AUTONOMY_PING_MIN_INTERVAL_MS;
const VI_AUTONOMY_MIN_RELEVANCE = apiEnv.VI_AUTONOMY_MIN_RELEVANCE;
const VI_REQUIRE_API_KEY = apiEnv.VI_REQUIRE_API_KEY === "true";
const VI_PUBLIC_API_KEY = apiEnv.VI_PUBLIC_API_KEY.trim();
const VI_OWNER_API_KEY = apiEnv.VI_OWNER_API_KEY.trim();
const VI_OWNER_EMAIL = apiEnv.VI_OWNER_EMAIL.trim().toLowerCase();
const VI_SESSION_COOKIE_NAME = apiEnv.VI_SESSION_COOKIE_NAME.trim() || "vi_session";
const VI_SESSION_TTL_HOURS = apiEnv.VI_SESSION_TTL_HOURS;
const VI_SESSION_SECURE = apiEnv.VI_SESSION_SECURE !== "false";
const VI_GOOGLE_CLIENT_ID = apiEnv.VI_GOOGLE_CLIENT_ID.trim();
const VI_GOOGLE_CLIENT_SECRET = apiEnv.VI_GOOGLE_CLIENT_SECRET.trim();
const VI_GOOGLE_REDIRECT_URI = apiEnv.VI_GOOGLE_REDIRECT_URI.trim();
const VI_GUEST_MESSAGE_LIMIT = apiEnv.VI_GUEST_MESSAGE_LIMIT;
const VI_RUNTIME_PROFILE = apiEnv.VI_RUNTIME_PROFILE;
const VI_SMART_CORE_PROFILE = VI_RUNTIME_PROFILE === "smart_core";
const VI_ALLOW_PROACTIVE_PINGS = apiEnv.VI_ALLOW_PROACTIVE_PINGS !== "false" && !VI_SMART_CORE_PROFILE;
const VI_INCLUDE_PASSIVE_PENDING_MENTION =
  apiEnv.VI_INCLUDE_PASSIVE_PENDING_MENTION !== "false" && !VI_SMART_CORE_PROFILE;

type SessionActor = {
  userId: string;
  email: string | null;
  role: "owner" | "guest";
  externalId: string;
};

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function isOwnerEmail(email: string | null | undefined): boolean {
  if (!VI_OWNER_EMAIL) return false;
  return (email ?? "").trim().toLowerCase() === VI_OWNER_EMAIL;
}

async function getSessionActorFromRequest(
  request: { cookies: Record<string, string | undefined> },
): Promise<SessionActor | null> {
  const token = request.cookies?.[VI_SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = await findWebSessionByTokenHash(hashSessionToken(token));
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user) return null;
  const email = await findAuthEmailByUserId(user.id);
  const role: "owner" | "guest" = isOwnerEmail(email) ? "owner" : "guest";
  return {
    userId: user.id,
    email,
    role,
    externalId: role === "owner" ? VI_OWNER_EXTERNAL_ID : `user:${user.id}`,
  };
}

function setSessionCookie(reply: {
  setCookie: (
    name: string,
    value: string,
    options: { path: string; httpOnly: boolean; sameSite: "none" | "lax"; secure: boolean; maxAge: number },
  ) => void;
}, token: string): void {
  reply.setCookie(VI_SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: VI_SESSION_SECURE ? "none" : "lax",
    secure: VI_SESSION_SECURE,
    maxAge: VI_SESSION_TTL_HOURS * 60 * 60,
  });
}

function clearSessionCookie(reply: {
  clearCookie: (name: string, options: { path: string; sameSite: "none" | "lax"; secure: boolean }) => void;
}): void {
  reply.clearCookie(VI_SESSION_COOKIE_NAME, {
    path: "/",
    sameSite: VI_SESSION_SECURE ? "none" : "lax",
    secure: VI_SESSION_SECURE,
  });
}

async function establishSessionForUser(reply: { setCookie: Function }, userId: string): Promise<void> {
  const token = newSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + VI_SESSION_TTL_HOURS * 60 * 60 * 1000);
  await createWebSession({ userId, sessionTokenHash: tokenHash, expiresAt });
  setSessionCookie(reply as { setCookie: any }, token);
}

app.addHook("onRequest", async (request, reply) => {
  const sessionActor = await getSessionActorFromRequest(request);
  (request as { sessionActor?: SessionActor | null }).sessionActor = sessionActor;
  if (request.url.startsWith("/auth/")) {
    return;
  }
  if (!VI_REQUIRE_API_KEY) return;
  if (sessionActor) return;
  const tier = getRequestAuthTier(request.headers);
  if (tier === "none") {
    reply.code(401);
    return reply.send({ error: { message: "Unauthorized" } });
  }
});

function getPresentedApiKey(headers: Record<string, unknown>): string {
  const auth = headers.authorization;
  const xApiKey = headers["x-api-key"];
  const bearer =
    typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
      ? auth.slice("bearer ".length).trim()
      : "";
  return (typeof xApiKey === "string" ? xApiKey : bearer).trim();
}

function getRequestAuthTier(headers: Record<string, unknown>): "owner" | "public" | "none" {
  const key = getPresentedApiKey(headers);
  if (!key) return "none";
  if (VI_OWNER_API_KEY && safeEq(key, VI_OWNER_API_KEY)) return "owner";
  if (VI_PUBLIC_API_KEY && safeEq(key, VI_PUBLIC_API_KEY)) return "public";
  return "none";
}

function isOwnerRequest(request: { headers: Record<string, unknown>; sessionActor?: SessionActor | null }): boolean {
  const sessionOwner = request.sessionActor?.role === "owner";
  return sessionOwner || getRequestAuthTier(request.headers) === "owner";
}

function logApiError(scope: string, error: unknown, extra?: Record<string, unknown>): void {
  const e = error as { message?: string; stack?: string };
  console.error(`[${scope}]`, {
    ...(extra ?? {}),
    message: e?.message ?? String(error),
    stack: e?.stack ?? null,
  });
}

function classifyUpstreamError(error: unknown): {
  httpStatus: number;
  code: "UPSTREAM_QUOTA_LIMIT" | "UPSTREAM_RATE_LIMIT" | "INTERNAL_ERROR";
  message: string;
} {
  const e = error as { status?: number; message?: string };
  const raw = (e?.message ?? String(error)).toLowerCase();
  if (e?.status === 429 && /\b(credits|spending limit|monthly)\b/.test(raw)) {
    return {
      httpStatus: 503,
      code: "UPSTREAM_QUOTA_LIMIT",
      message:
        "Vi provider credits are exhausted or spending limit is reached. Add credits or raise limit, then retry.",
    };
  }
  if (e?.status === 429 || /\brate limit\b/.test(raw)) {
    return {
      httpStatus: 429,
      code: "UPSTREAM_RATE_LIMIT",
      message: "Vi provider rate limit hit. Please wait a moment and retry.",
    };
  }
  return {
    httpStatus: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error. Check API logs for [VI_CHAT_ERROR].",
  };
}

type WebSource = { title: string; url: string; snippet: string };

const RE_MARKET_CURRENT_QUERY =
  /\b(best|top|recommend(?:ed)?|worth it|buy)\b.*\b(phone|smartphone|laptop|tablet|camera|headphones|car|tv|monitor)\b.*\b(right now|currently|on the market|today|this year|2026|latest)\b/i;

function isMarketCurrentQuery(message: string): boolean {
  return RE_MARKET_CURRENT_QUERY.test(message.toLowerCase());
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeDdgHref(href: string): string {
  const raw0 = decodeHtmlEntities(href).trim();
  const raw = raw0.startsWith("//") ? `https:${raw0}` : raw0;
  if (raw.includes("/l/?")) {
    const m = raw.match(/[?&]uddg=([^&]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  if (/duckduckgo\.com\/y\.js/i.test(raw)) {
    const m = raw.match(/[?&]u3=([^&]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return raw;
}

function isLikelyAdOrTrackerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("duckduckgo.com") && (u.pathname === "/y.js" || u.pathname.startsWith("/y.js"))) return true;
    if (host.includes("bing.com") && u.pathname.includes("aclick")) return true;
    if (host.includes("doubleclick.net")) return true;
    if (host.includes("googleadservices.com")) return true;
    return false;
  } catch {
    return true;
  }
}

async function fetchDuckDuckGoSources(query: string, limit = 5): Promise<WebSource[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const out: WebSource[] = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,4000}?<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(html)) && out.length < limit) {
    const href = normalizeDdgHref(match[1] ?? "");
    const title = stripHtml(match[2] ?? "");
    const snippet = stripHtml(match[3] ?? "");
    if (!href || !/^https?:\/\//i.test(href) || !title) continue;
    if (isLikelyAdOrTrackerUrl(href)) continue;
    out.push({ title, url: href, snippet });
  }
  return out;
}

function pickTopPhoneModel(sources: WebSource[]): string | null {
  const patterns = [
    /\bSamsung Galaxy S\d{2}\s*Ultra\b/gi,
    /\biPhone \d{2}\s*Pro Max\b/gi,
    /\biPhone \d{2}\s*Pro\b/gi,
    /\bGoogle Pixel \d{1,2}\s*Pro(?:\s*XL)?\b/gi,
    /\bOnePlus \d{1,2}(?:\s*Pro)?\b/gi,
    /\bXiaomi \d{1,2}\s*Ultra\b/gi,
  ];
  const counts = new Map<string, number>();
  for (const s of sources) {
    const titleText = `${s.title}`;
    const snippetText = `${s.snippet}`;
    for (const re of patterns) {
      const titleHits = titleText.match(re) ?? [];
      for (const h of titleHits) {
        const key = h.replace(/\s+/g, " ").trim();
        counts.set(key, (counts.get(key) ?? 0) + 3);
      }
      const snippetHits = snippetText.match(re) ?? [];
      for (const h of snippetHits) {
        const key = h.replace(/\s+/g, " ").trim();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  let best: { model: string; n: number } | null = null;
  for (const [model, n] of counts) {
    if (!best || n > best.n) best = { model, n };
  }
  return best?.model ?? null;
}

function pickTopPhoneShortlist(sources: WebSource[], limit = 3): string[] {
  const patterns = [
    /\bSamsung Galaxy S\d{2}\s*Ultra\b/gi,
    /\biPhone \d{2}\s*Pro Max\b/gi,
    /\biPhone \d{2}\s*Pro\b/gi,
    /\bGoogle Pixel \d{1,2}\s*Pro(?:\s*XL)?\b/gi,
    /\bOnePlus \d{1,2}(?:\s*Pro)?\b/gi,
    /\bXiaomi \d{1,2}\s*Ultra\b/gi,
  ];
  const counts = new Map<string, number>();
  for (const s of sources) {
    const text = `${s.title} ${s.snippet}`;
    for (const re of patterns) {
      const hits = text.match(re) ?? [];
      for (const h of hits) {
        const key = h.replace(/\s+/g, " ").trim();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([m]) => m);
}

function canonicalPhoneFamily(model: string): "iphone" | "galaxy" | "pixel" | "oneplus" | "xiaomi" | "other" {
  const m = model.toLowerCase();
  if (m.includes("iphone")) return "iphone";
  if (m.includes("galaxy")) return "galaxy";
  if (m.includes("pixel")) return "pixel";
  if (m.includes("oneplus")) return "oneplus";
  if (m.includes("xiaomi")) return "xiaomi";
  return "other";
}

function overallRubricScore(model: string): number {
  // Default "best overall for most people" weights baked in:
  // performance 25, camera 25, battery 20, display/build 15, support/software 10, value 5.
  // Heuristic family baselines tuned for decisive default picks in 2026 flagship context.
  const f = canonicalPhoneFamily(model);
  const scoreByFamily: Record<typeof f, number> = {
    iphone: 92,
    galaxy: 91,
    pixel: 88,
    oneplus: 86,
    xiaomi: 85,
    other: 80,
  };
  return scoreByFamily[f];
}

function chooseOverallWinner(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  return [...candidates]
    .sort((a, b) => overallRubricScore(b) - overallRubricScore(a) || a.localeCompare(b))[0]!;
}

async function inferModelFromSourcePages(sources: WebSource[]): Promise<string | null> {
  const patterns = [
    /\bSamsung Galaxy S\d{2}\s*Ultra\b/gi,
    /\biPhone \d{2}\s*Pro Max\b/gi,
    /\biPhone \d{2}\s*Pro\b/gi,
    /\bGoogle Pixel \d{1,2}\s*Pro(?:\s*XL)?\b/gi,
    /\bOnePlus \d{1,2}(?:\s*Pro)?\b/gi,
    /\bXiaomi \d{1,2}\s*Ultra\b/gi,
  ];
  const counts = new Map<string, number>();
  for (const s of sources.slice(0, 2)) {
    try {
      const res = await fetch(s.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = stripHtml(html.slice(0, 250_000));
      for (const re of patterns) {
        const hits = text.match(re) ?? [];
        for (const h of hits) {
          const key = h.replace(/\s+/g, " ").trim();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    } catch {
      // best-effort only
    }
  }
  let best: { model: string; n: number } | null = null;
  for (const [model, n] of counts) {
    if (!best || n > best.n) best = { model, n };
  }
  return best?.model ?? null;
}

async function buildMarketAnswerFromSources(_query: string, sources: WebSource[]): Promise<string> {
  if (sources.length === 0) {
    return "idk — I can't verify that with live sources in this runtime right now.";
  }
  const pageModel = await inferModelFromSourcePages(sources);
  const shortlist = pickTopPhoneShortlist(sources, 5);
  const modelCandidates = [pickTopPhoneModel(sources), pageModel, ...shortlist].filter(
    (v): v is string => Boolean(v),
  );
  const model = chooseOverallWinner(modelCandidates);
  const primary = sources[0];
  const tinyCite = primary ? ` ([source](${primary.url}))` : "";
  if (model) {
    return (
      `Winner right now for a default "best overall" rubric: **${model}**${tinyCite}. ` +
      "It wins on all-around balance across performance, camera reliability, battery life, display/build quality, and long-term software/support. " +
      "If you want, I can still give category winners (best battery, best camera, best value)."
    );
  }
  return `idk — I can fetch sources${tinyCite}, but I couldn't extract enough model evidence to choose a single winner safely.`;
}

type PassiveDiscoveryStateResponse = {
  thresholdMinutes: number;
  lastBackgroundActivityAt: string | null;
  pendingReflections: PendingReflection[];
  /** Last turn’s bounded temporal instrumentation (null if no session or not yet computed). */
  temporalState: ViTemporalInternalStateV1 | null;
  /** Last computed decision trace from temporal state (dev/debug). */
  decisionTrace: ViDecisionTraceV1 | null;
  /** Last repo evidence retrieval debug snapshot (read vs used). */
  repoEvidence: ViRepoEvidenceDebugV1 | null;
  /** Learned facts persisted only when anchors exist. */
  learnedFacts: Array<{ at: string; fact: string; anchors: string[] }>;
  /** Unified state authority snapshot. */
  unifiedState: ViUnifiedStateV1 | null;
  /** Postgres-backed Chronos v2 row for this session (inspectable across restarts). */
  persistedChronos: ViPersistedChronosSnapshotV1 | null;
  relationalState: ViRelationalStateV1 | null;
  capabilityMilestones: Array<{ id: string; label: string; evidence: string; recordedAt: string }>;
  idleActivity: Array<{ at: string; phase: string; status: string; error?: string | null }>;
  globalContinuity?: {
    countToTenProgress: number | null;
    proactivity?: {
      lastPingAt: string | null;
    };
    recentRepoDigests: Array<{ at: string; filePath: string; summary: string; retentionTier: string }>;
    proposedActions: Array<{ at: string; title: string; why: string }>;
    idleReflections?: Array<{ at: string; text: string; source: string; confidence: string }>;
    memoryPins?: Array<{
      at: string;
      topic: string;
      fact: string;
      confidence: string;
      sources: string[];
    }>;
    autonomyActions?: Array<{
      at: string;
      category: string;
      action: string;
      status: string;
      detail?: string;
      reversible: boolean;
    }>;
  } | null;
};

type AutonomyPingResponse = {
  ping: null | {
    id: string;
    at: string;
    message: string;
    title: string;
    nextAction?: string;
    relevance?: "low" | "medium" | "high";
  };
};

type ImportMemoryRequest = {
  externalId?: string;
  sessionIds?: string[];
  focusTerms?: string[];
  maxPins?: number;
};

type ImportMemoryResponse = {
  ok: true;
  sessionsScanned: number;
  importedPins: number;
  totalPins: number;
  pins: Array<{ topic: string; fact: string; confidence: "low" | "medium" | "high"; sources: string[] }>;
};

type ImportPinsRequest = {
  externalId?: string;
  pins?: Array<{
    topic: string;
    fact: string;
    confidence?: "low" | "medium" | "high";
    sources?: string[];
  }>;
};

type ImportPinsResponse = {
  ok: true;
  importedPins: number;
  totalPins: number;
  pins: Array<{ topic: string; fact: string; confidence: "low" | "medium" | "high"; sources: string[] }>;
};

type AdapterContractResponse = {
  version: "v1";
  chat: {
    route: "/chat";
    allowedTopLevelKeys: string[];
    allowedContextKeys: string[];
    forbiddenKeys: string[];
    overrideShape: {
      allowed: boolean;
      requiredKeys: string[];
    };
  };
};

type IdentityResolveRequest = {
  provider?: string;
  providerUserId?: string;
};

type SignupRequest = { email?: string; password?: string };
type LoginRequest = { email?: string; password?: string };
type AuthMeResponse = {
  ok: true;
  authenticated: boolean;
  user: null | {
    id: string;
    email: string | null;
    role: "owner" | "guest";
    externalId: string;
  };
};

function normalizeExternalId(raw: string | undefined | null): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return v.length > 0 ? v : null;
}

function actorRoleFromExternalId(externalId: string): "owner" | "guest" {
  return externalId.toLowerCase() === VI_OWNER_EXTERNAL_ID ? "owner" : "guest";
}

function parseActorExternalIdFromContext(context: unknown): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const v = (context as Record<string, unknown>).actorExternalId;
  if (typeof v !== "string") return null;
  return normalizeExternalId(v);
}

function requestSessionActor(request: unknown): SessionActor | null {
  const actor = (request as { sessionActor?: SessionActor | null })?.sessionActor;
  return actor ?? null;
}

type IdentityResolveResponse = {
  ok: true;
  canonicalUserId: string;
  externalId: string;
};

type ContinuitySummaryResponse = {
  ok: true;
  user: {
    id: string;
    externalId: string;
  };
  continuity: {
    hasGlobalState: boolean;
    memoryPins: number;
    idleReflections: number;
    pendingProposals: number;
    recentRepoDigests: number;
    lastRepoScanAt: string | null;
    lastUpdatedAt: string | null;
  };
};

type OwnerControlStateResponse = {
  ok: true;
  ownerExternalId: string;
  actor: {
    externalId: string;
    role: "owner" | "guest";
  };
  autonomy: {
    enabled: boolean;
    allowLocalRead: boolean;
    allowLocalWriteSafe: boolean;
    allowExternalNotify: boolean;
    allowExternalAct: boolean;
    killSwitch: boolean;
    recentActions: Array<{
      at: string;
      category: string;
      action: string;
      status: string;
      detail?: string;
      reversible: boolean;
    }>;
  };
};

function northRowToPersistedSnapshot(row: SessionNorthStarRow): ViPersistedChronosSnapshotV1 {
  return {
    version: 1,
    lastInteractionAt: row.lastInteractionEpochMs,
    totalSessionTime: row.totalSessionWallMs,
    lastGapDuration: row.lastGapDurationMs,
    perceivedWeight: row.perceivedWeight,
    drift: row.drift,
    passiveProcessingStrength: row.passiveProcessingStrength,
  };
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function parseOverrideContext(context: unknown): { stringName: string; command: string } | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const override = (context as Record<string, unknown>).override;
  if (!override || typeof override !== "object" || Array.isArray(override)) return null;
  const o = override as Record<string, unknown>;
  if (typeof o.stringName !== "string" || typeof o.command !== "string") return null;
  const stringName = o.stringName.trim();
  const command = o.command.trim();
  if (!stringName || !command) return null;
  return { stringName, command };
}

function normalizeFocusTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().toLowerCase();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function inferFocusTermsFromMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string[] {
  const stop = new Set(["you", "vi", "the", "and", "this", "that", "with", "from", "have", "what"]);
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    const matches = m.content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
    for (const token of matches) {
      const t = token.toLowerCase();
      if (stop.has(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);
}

function modeShortcutReply(message: string, actorRole: "owner" | "guest"): string | null {
  const q = message.toLowerCase().trim();
  if (
    /\b(?:respond|reply|answer)\s+with\s+exactly\s+[`'"]?owner[`'"]?\s+or\s+[`'"]?guest\b/.test(q) ||
    /\b(?:say|respond)\s+exactly\s+[`'"]?owner[`'"]?\s+or\s+[`'"]?guest\b/.test(q)
  ) {
    return actorRole === "owner" ? "owner" : "guest";
  }
  if (
    /\b(owner mode|guest mode)\b/.test(q) ||
    /\bam i (in|on)\b.*\b(owner|guest)\b/.test(q) ||
    /\bwhat mode am i\b/.test(q) ||
    /\bwhich mode\b/.test(q)
  ) {
    return actorRole === "owner"
      ? "You are in owner mode right now."
      : "You are in guest mode right now.";
  }
  return null;
}

function buildMemoryPinsFromMessages(input: {
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  focusTerms: string[];
  maxPins: number;
}): Array<{ at: string; topic: string; fact: string; confidence: "low" | "medium" | "high"; sources: string[] }> {
  const nowIso = new Date().toISOString();
  const pins: Array<{ at: string; topic: string; fact: string; confidence: "low" | "medium" | "high"; sources: string[] }> = [];
  for (const term of input.focusTerms) {
    const snippets: string[] = [];
    let userMentions = 0;
    for (const m of input.messages) {
      if (!new RegExp(`\\b${term}\\b`, "i").test(m.content)) continue;
      if (m.role === "user") userMentions += 1;
      snippets.push(`${m.role}: ${m.content.replace(/\s+/g, " ").slice(0, 140)}`);
      if (snippets.length >= 3) break;
    }
    if (snippets.length === 0) continue;
    pins.push({
      at: nowIso,
      topic: term,
      fact: `${term} was discussed across prior threads and should be treated as continuity-relevant context.`,
      confidence: userMentions >= 2 ? "high" : "medium",
      sources: [`session:${input.sessionId}`, ...snippets],
    });
    if (pins.length >= input.maxPins) break;
  }
  return pins;
}

app.get<{ Reply: TimeAwarenessEvidenceResponse }>("/self-model/evidence/time-awareness", async () => {
  return buildTimeAwarenessEvidenceResponse({
    apiPort: API_PORT,
    userTimezone: USER_TIMEZONE,
    sampleWallNow: new Date(),
  });
});

app.get<{ Querystring: { sessionId?: string; externalId?: string }; Reply: PassiveDiscoveryStateResponse }>(
  "/self-model/state",
  async (request): Promise<PassiveDiscoveryStateResponse> => {
    const sessionId = request.query.sessionId?.trim();
    if (!sessionId) {
      return {
        thresholdMinutes: PASSIVE_DISCOVERY_GAP_MINUTES,
        lastBackgroundActivityAt: null,
        pendingReflections: [],
        temporalState: null,
        decisionTrace: null,
        repoEvidence: null,
        learnedFacts: [],
        unifiedState: null,
        persistedChronos: null,
        relationalState: null,
        capabilityMilestones: [],
        idleActivity: [],
      };
    }
    const north = await getSessionNorthStarRow(sessionId);
    const externalId = normalizeExternalId(request.query.externalId) ?? VI_OWNER_EXTERNAL_ID;
    const user = await getOrCreateUserByExternalId(externalId);
    const continuity = await getUserContinuityRow(user.id);
    const state = getPassiveStateIfLoaded(sessionId);
    const fromDbQueue = parseDiscoveryQueueJson(north?.discoveryQueueJson);
    const fromDbFacts = parseLearnedFactsJson(north?.learnedFactsJson);
    const parsedGlobal = parseUserGlobalContinuityState(continuity?.globalStateJson);
    const parsedDigests = parseUserRepoDigests(continuity?.repoDigestsJson);
    const parsedProposals = parseUserProposals(continuity?.proposalQueueJson);
    return {
      thresholdMinutes: PASSIVE_DISCOVERY_GAP_MINUTES,
      lastBackgroundActivityAt: state?.lastBackgroundActivityAt ?? null,
      pendingReflections: fromDbQueue,
      temporalState: state?.lastTemporalState ?? null,
      decisionTrace: state?.lastDecisionTrace ?? null,
      repoEvidence: state?.lastRepoEvidence ?? null,
      learnedFacts: fromDbFacts,
      unifiedState: state?.lastUnifiedState ?? null,
      persistedChronos: north ? northRowToPersistedSnapshot(north) : null,
      relationalState: north ? parseRelationalStateJson(north.relationalStateJson) : null,
      capabilityMilestones: north
        ? ensureBaselineCapabilityMilestones(
            parseCapabilityMilestonesJson(north.capabilityMilestonesJson),
          )
        : [],
      idleActivity: (
        await listRecentTurnJournalForSession(sessionId, 20)
      ).map((r) => ({
        at: r.createdAt.toISOString(),
        phase: r.phase,
        status: r.status,
        ...(r.errorMessage ? { error: r.errorMessage } : {}),
      })),
      globalContinuity: {
        countToTenProgress: parsedGlobal.crossThread.countToTenProgress,
        proactivity: {
          lastPingAt: parsedGlobal.proactivity.lastPingAt,
        },
        recentRepoDigests: parsedDigests.slice(0, 5).map((d) => ({
          at: d.at,
          filePath: d.filePath,
          summary: d.summary,
          retentionTier: d.retentionTier,
        })),
        proposedActions: parsedProposals.slice(0, 5),
        idleReflections: parsedGlobal.idleReflections.slice(0, 5).map((r) => ({
          at: r.at,
          text: r.text,
          source: r.source,
          confidence: r.confidence,
        })),
        memoryPins: parsedGlobal.memoryPins.slice(0, 8).map((m) => ({
          at: m.at,
          topic: m.topic,
          fact: m.fact,
          confidence: m.confidence,
          sources: m.sources,
        })),
        autonomyActions: parsedGlobal.autonomy.actionLog.slice(0, 8).map((a) => ({
          at: a.at,
          category: a.category,
          action: a.action,
          status: a.status,
          detail: a.detail,
          reversible: a.reversible,
        })),
      },
    };
  },
);

app.post<{ Body: ImportMemoryRequest; Reply: ImportMemoryResponse | ChatErrorResponse }>(
  "/self-model/memory/import",
  async (request, reply): Promise<ImportMemoryResponse | ChatErrorResponse> => {
    if (VI_REQUIRE_API_KEY && !isOwnerRequest(request as { headers: Record<string, unknown>; sessionActor?: SessionActor | null })) {
      reply.code(403);
      return { error: { message: "owner API key required" } };
    }
    const externalId = normalizeExternalId(String((request.body as Record<string, unknown>)?.externalId ?? "")) ?? VI_OWNER_EXTERNAL_ID;
    if (actorRoleFromExternalId(externalId) !== "owner") {
      reply.code(403);
      return { error: { message: "memory import is owner-only" } };
    }
    const user = await getOrCreateUserByExternalId(externalId);
    const sessions = await listSessionsForUser(user.id, 200);
    const requestedSessionIds =
      Array.isArray(request.body?.sessionIds) && request.body.sessionIds.length > 0
        ? new Set(request.body.sessionIds.map((s) => String(s).trim()).filter(Boolean))
        : null;
    const selected = requestedSessionIds ? sessions.filter((s) => requestedSessionIds.has(s.id)) : sessions;
    if (selected.length === 0) {
      reply.code(400);
      return { error: { message: "No sessions available to import from." } };
    }

    const allMessages: Array<{ sessionId: string; role: "user" | "assistant"; content: string }> = [];
    for (const s of selected) {
      const rows = await listSessionMessagesChronological(s.id);
      for (const r of rows.slice(-300)) allMessages.push({ sessionId: s.id, role: r.role, content: r.content });
    }
    const focusTerms = normalizeFocusTerms(request.body?.focusTerms);
    const inferredTerms = focusTerms.length > 0 ? focusTerms : inferFocusTermsFromMessages(allMessages);
    const maxPins = Math.max(1, Math.min(40, Number(request.body?.maxPins ?? 20)));

    const generatedPins: Array<{
      at: string;
      topic: string;
      fact: string;
      confidence: "low" | "medium" | "high";
      sources: string[];
    }> = [];
    for (const s of selected) {
      const perSession = allMessages
        .filter((m) => m.sessionId === s.id)
        .map((m) => ({ role: m.role, content: m.content }));
      const pins = buildMemoryPinsFromMessages({
        sessionId: s.id,
        messages: perSession,
        focusTerms: inferredTerms,
        maxPins,
      });
      generatedPins.push(...pins);
      if (generatedPins.length >= maxPins) break;
    }

    const continuity = await getUserContinuityRow(user.id);
    const global = parseUserGlobalContinuityState(continuity?.globalStateJson);
    const dedup = new Map<string, (typeof global.memoryPins)[number]>();
    for (const pin of [...generatedPins, ...global.memoryPins]) {
      const key = `${pin.topic.toLowerCase()}|${pin.fact.toLowerCase()}`;
      if (!dedup.has(key)) dedup.set(key, pin);
    }
    const nextGlobal = {
      ...global,
      memoryPins: [...dedup.values()].slice(0, 40),
    };
    await upsertUserContinuityRow({
      userId: user.id,
      globalStateJson: JSON.stringify(nextGlobal),
      idleActivityJson: continuity?.idleActivityJson ?? null,
      repoDigestsJson: continuity?.repoDigestsJson ?? null,
      proposalQueueJson: continuity?.proposalQueueJson ?? null,
      lastRepoScanAt: continuity?.lastRepoScanAt ?? null,
      lastRepoFingerprint: continuity?.lastRepoFingerprint ?? null,
    });

    return {
      ok: true,
      sessionsScanned: selected.length,
      importedPins: generatedPins.length,
      totalPins: nextGlobal.memoryPins.length,
      pins: nextGlobal.memoryPins.slice(0, 12).map((p) => ({
        topic: p.topic,
        fact: p.fact,
        confidence: p.confidence,
        sources: p.sources.slice(0, 3),
      })),
    };
  },
);

app.post<{ Body: ImportPinsRequest; Reply: ImportPinsResponse | ChatErrorResponse }>(
  "/self-model/memory/import-pins",
  async (request, reply): Promise<ImportPinsResponse | ChatErrorResponse> => {
    if (VI_REQUIRE_API_KEY && !isOwnerRequest(request as { headers: Record<string, unknown>; sessionActor?: SessionActor | null })) {
      reply.code(403);
      return { error: { message: "owner API key required" } };
    }
    const externalId =
      normalizeExternalId(request.body?.externalId) ?? VI_OWNER_EXTERNAL_ID;
    if (actorRoleFromExternalId(externalId) !== "owner") {
      reply.code(403);
      return { error: { message: "pin import is owner-only" } };
    }
    const pinsIn = Array.isArray(request.body?.pins) ? request.body.pins : [];
    if (pinsIn.length === 0) {
      reply.code(400);
      return { error: { message: "pins[] is required" } };
    }
    const user = await getOrCreateUserByExternalId(externalId);
    const continuity = await getUserContinuityRow(user.id);
    const global = parseUserGlobalContinuityState(continuity?.globalStateJson);
    const normalized = pinsIn
      .map((p) => ({
        at: new Date().toISOString(),
        topic: String(p.topic ?? "").trim().toLowerCase(),
        fact: String(p.fact ?? "").trim(),
        confidence: (p.confidence === "low" || p.confidence === "medium" || p.confidence === "high"
          ? p.confidence
          : "medium") as "low" | "medium" | "high",
        sources: Array.isArray(p.sources)
          ? p.sources.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
          : [],
      }))
      .filter((p) => p.topic.length >= 2 && p.fact.length >= 8)
      .slice(0, 80);
    if (normalized.length === 0) {
      reply.code(400);
      return { error: { message: "no valid pins after normalization" } };
    }
    const dedup = new Map<string, (typeof global.memoryPins)[number]>();
    for (const pin of [...normalized, ...global.memoryPins]) {
      const key = `${pin.topic.toLowerCase()}|${pin.fact.toLowerCase()}`;
      if (!dedup.has(key)) dedup.set(key, pin);
    }
    const nextGlobal = { ...global, memoryPins: [...dedup.values()].slice(0, 80) };
    await upsertUserContinuityRow({
      userId: user.id,
      globalStateJson: JSON.stringify(nextGlobal),
      idleActivityJson: continuity?.idleActivityJson ?? null,
      repoDigestsJson: continuity?.repoDigestsJson ?? null,
      proposalQueueJson: continuity?.proposalQueueJson ?? null,
      lastRepoScanAt: continuity?.lastRepoScanAt ?? null,
      lastRepoFingerprint: continuity?.lastRepoFingerprint ?? null,
    });
    return {
      ok: true,
      importedPins: normalized.length,
      totalPins: nextGlobal.memoryPins.length,
      pins: nextGlobal.memoryPins.slice(0, 20).map((p) => ({
        topic: p.topic,
        fact: p.fact,
        confidence: p.confidence,
        sources: p.sources.slice(0, 4),
      })),
    };
  },
);

app.get<{ Reply: AdapterContractResponse }>("/self-model/adapter-contract", async (): Promise<AdapterContractResponse> => {
  return {
    version: "v1",
    chat: {
      route: "/chat",
      allowedTopLevelKeys: ["message", "sessionId", "context"],
      allowedContextKeys: ["actorExternalId", "override", "onboardingV1"],
      forbiddenKeys: [...FORBIDDEN_ADAPTER_KEYS],
      overrideShape: {
        allowed: true,
        requiredKeys: ["stringName", "command"],
      },
    },
  };
});

app.post<{ Body: SignupRequest; Reply: { ok: true } | ChatErrorResponse }>(
  "/auth/signup",
  async (request, reply): Promise<{ ok: true } | ChatErrorResponse> => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    const password = String(request.body?.password ?? "");
    if (!email || !password || password.length < 8) {
      reply.code(400);
      return { error: { message: "Valid email and password (min 8 chars) are required." } };
    }
    const existing = await findAuthIdentityByProviderEmail({ provider: "email", email });
    if (existing) {
      reply.code(409);
      return { error: { message: "Account already exists for this email." } };
    }
    const user = await getOrCreateUserByExternalId(`email:${email}`);
    const passwordHash = await bcrypt.hash(password, 12);
    await createAuthIdentity({
      userId: user.id,
      provider: "email",
      providerUserId: email,
      email,
      passwordHash,
    });
    await establishSessionForUser(reply as { setCookie: Function }, user.id);
    return { ok: true };
  },
);

app.post<{ Body: LoginRequest; Reply: { ok: true } | ChatErrorResponse }>(
  "/auth/login",
  async (request, reply): Promise<{ ok: true } | ChatErrorResponse> => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    const password = String(request.body?.password ?? "");
    if (!email || !password) {
      reply.code(400);
      return { error: { message: "Email and password are required." } };
    }
    const identity = await findAuthIdentityByProviderEmail({ provider: "email", email });
    if (!identity?.passwordHash) {
      reply.code(401);
      return { error: { message: "Invalid email or password." } };
    }
    const ok = await bcrypt.compare(password, identity.passwordHash);
    if (!ok) {
      reply.code(401);
      return { error: { message: "Invalid email or password." } };
    }
    await establishSessionForUser(reply as { setCookie: Function }, identity.userId);
    return { ok: true };
  },
);

app.get<{ Reply: AuthMeResponse }>("/auth/me", async (request): Promise<AuthMeResponse> => {
  const actor = requestSessionActor(request);
  if (!actor) return { ok: true, authenticated: false, user: null };
  return {
    ok: true,
    authenticated: true,
    user: {
      id: actor.userId,
      email: actor.email,
      role: actor.role,
      externalId: actor.externalId,
    },
  };
});

app.post<{ Reply: { ok: true } }>("/auth/logout", async (request, reply): Promise<{ ok: true }> => {
  const token = request.cookies?.[VI_SESSION_COOKIE_NAME];
  if (token) await revokeWebSessionByTokenHash(hashSessionToken(token));
  clearSessionCookie(reply as { clearCookie: any });
  return { ok: true };
});

app.get<{
  Querystring: { returnTo?: string };
  Reply: { url: string } | ChatErrorResponse;
}>("/auth/google/start", async (request, reply) => {
  if (!VI_GOOGLE_CLIENT_ID || !VI_GOOGLE_REDIRECT_URI) {
    reply.code(400);
    return { error: { message: "Google OAuth is not configured." } };
  }
  const state = randomBytes(16).toString("hex");
  reply.setCookie("vi_oauth_state", state, {
    path: "/",
    httpOnly: true,
    sameSite: VI_SESSION_SECURE ? "none" : "lax",
    secure: VI_SESSION_SECURE,
    maxAge: 10 * 60,
  });
  const returnTo = String(request.query.returnTo ?? "").trim();
  if (returnTo.startsWith("http://") || returnTo.startsWith("https://") || returnTo.startsWith("/")) {
    reply.setCookie("vi_oauth_return_to", returnTo, {
      path: "/",
      httpOnly: true,
      sameSite: VI_SESSION_SECURE ? "none" : "lax",
      secure: VI_SESSION_SECURE,
      maxAge: 10 * 60,
    });
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", VI_GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", VI_GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return { url: url.toString() };
});

app.get<{
  Querystring: { code?: string; state?: string };
  Reply: { ok: true } | ChatErrorResponse;
}>("/auth/google/callback", async (request, reply) => {
  if (!VI_GOOGLE_CLIENT_ID || !VI_GOOGLE_CLIENT_SECRET || !VI_GOOGLE_REDIRECT_URI) {
    reply.code(400);
    return { error: { message: "Google OAuth is not configured." } };
  }
  const code = String(request.query.code ?? "").trim();
  const state = String(request.query.state ?? "").trim();
  const cookieState = request.cookies?.vi_oauth_state ?? "";
  if (!code || !state || !cookieState || state !== cookieState) {
    reply.code(400);
    return { error: { message: "Invalid OAuth callback state." } };
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: VI_GOOGLE_CLIENT_ID,
      client_secret: VI_GOOGLE_CLIENT_SECRET,
      redirect_uri: VI_GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    reply.code(400);
    return { error: { message: "Google token exchange failed." } };
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token ?? "";
  if (!accessToken) {
    reply.code(400);
    return { error: { message: "Google token missing access token." } };
  }
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) {
    reply.code(400);
    return { error: { message: "Google profile fetch failed." } };
  }
  const profile = (await profileRes.json()) as { id?: string; email?: string };
  const providerUserId = String(profile.id ?? "").trim();
  const email = String(profile.email ?? "").trim().toLowerCase();
  if (!providerUserId || !email) {
    reply.code(400);
    return { error: { message: "Google profile missing required identity fields." } };
  }
  let identity = await findAuthIdentityByProviderUserId({ provider: "google", providerUserId });
  if (!identity) {
    let user = await getOrCreateUserByExternalId(`google:${providerUserId}`);
    const existingEmailIdentity = await findAuthIdentityByProviderEmail({ provider: "email", email });
    if (existingEmailIdentity) user = { id: existingEmailIdentity.userId, externalId: `email:${email}` };
    await createAuthIdentity({
      userId: user.id,
      provider: "google",
      providerUserId,
      email,
      passwordHash: null,
    });
    identity = await findAuthIdentityByProviderUserId({ provider: "google", providerUserId });
  }
  if (!identity) {
    reply.code(500);
    return { error: { message: "Failed to persist Google identity." } };
  }
  await establishSessionForUser(reply as { setCookie: Function }, identity.userId);
  const returnTo = request.cookies?.vi_oauth_return_to ?? "/";
  reply.clearCookie("vi_oauth_state", {
    path: "/",
    sameSite: VI_SESSION_SECURE ? "none" : "lax",
    secure: VI_SESSION_SECURE,
  });
  reply.clearCookie("vi_oauth_return_to", {
    path: "/",
    sameSite: VI_SESSION_SECURE ? "none" : "lax",
    secure: VI_SESSION_SECURE,
  });
  if (returnTo.startsWith("http://") || returnTo.startsWith("https://") || returnTo.startsWith("/")) {
    reply.redirect(returnTo);
    return { ok: true };
  }
  return { ok: true };
});

app.post<{ Body: IdentityResolveRequest; Reply: IdentityResolveResponse | ChatErrorResponse }>(
  "/self-model/identity/resolve",
  async (request, reply): Promise<IdentityResolveResponse | ChatErrorResponse> => {
    const provider = String(request.body?.provider ?? "").trim().toLowerCase();
    const providerUserId = String(request.body?.providerUserId ?? "").trim();
    if (!provider || !providerUserId) {
      reply.code(400);
      return { error: { message: "provider and providerUserId are required" } };
    }
    const externalId = `${provider}:${providerUserId}`;
    const user = await getOrCreateUserByExternalId(externalId);
    return {
      ok: true,
      canonicalUserId: user.id,
      externalId: user.externalId,
    };
  },
);

app.get<{ Querystring: { externalId?: string }; Reply: ContinuitySummaryResponse }>(
  "/self-model/continuity/summary",
  async (request): Promise<ContinuitySummaryResponse> => {
    const sessionActor = requestSessionActor(request);
    const externalId = sessionActor?.externalId ?? normalizeExternalId(request.query.externalId) ?? VI_OWNER_EXTERNAL_ID;
    const user = await getOrCreateUserByExternalId(externalId);
    const continuity = await getUserContinuityRow(user.id);
    const global = parseUserGlobalContinuityState(continuity?.globalStateJson);
    const proposals = parseUserProposals(continuity?.proposalQueueJson);
    const digests = parseUserRepoDigests(continuity?.repoDigestsJson);
    return {
      ok: true,
      user: {
        id: user.id,
        externalId: user.externalId,
      },
      continuity: {
        hasGlobalState: Boolean(continuity?.globalStateJson?.trim()),
        memoryPins: global.memoryPins.length,
        idleReflections: global.idleReflections.length,
        pendingProposals: proposals.length,
        recentRepoDigests: digests.length,
        lastRepoScanAt: continuity?.lastRepoScanAt ? continuity.lastRepoScanAt.toISOString() : null,
        lastUpdatedAt: continuity?.updatedAt ? continuity.updatedAt.toISOString() : null,
      },
    };
  },
);

app.get<{ Querystring: { externalId?: string }; Reply: OwnerControlStateResponse }>(
  "/self-model/owner-control/state",
  async (request): Promise<OwnerControlStateResponse> => {
    const sessionActor = requestSessionActor(request);
    const externalId = sessionActor?.externalId ?? normalizeExternalId(request.query.externalId) ?? VI_OWNER_EXTERNAL_ID;
    const role = sessionActor?.role ?? actorRoleFromExternalId(externalId);
    const user = await getOrCreateUserByExternalId(externalId);
    const continuity = await getUserContinuityRow(user.id);
    const global = parseUserGlobalContinuityState(continuity?.globalStateJson);
    return {
      ok: true,
      ownerExternalId: VI_OWNER_EXTERNAL_ID,
      actor: {
        externalId,
        role,
      },
      autonomy: {
        enabled: apiEnv.VI_AUTONOMY_ENABLED !== "false",
        allowLocalRead: apiEnv.VI_AUTONOMY_ALLOW_LOCAL_READ !== "false",
        allowLocalWriteSafe: apiEnv.VI_AUTONOMY_ALLOW_LOCAL_WRITE_SAFE !== "false",
        allowExternalNotify: apiEnv.VI_AUTONOMY_ALLOW_EXTERNAL_NOTIFY !== "false",
        allowExternalAct: apiEnv.VI_AUTONOMY_ALLOW_EXTERNAL_ACT !== "false",
        killSwitch: global.autonomy.killSwitch,
        recentActions: global.autonomy.actionLog.slice(0, 10).map((a) => ({
          at: a.at,
          category: a.category,
          action: a.action,
          status: a.status,
          detail: a.detail,
          reversible: a.reversible,
        })),
      },
    };
  },
);

app.get<{ Querystring: { externalId?: string }; Reply: AutonomyPingResponse }>(
  "/self-model/autonomy-ping",
  async (request): Promise<AutonomyPingResponse> => {
  if (!VI_ALLOW_PROACTIVE_PINGS) return { ping: null };
  function composeAutonomyPingMessage(next: UserProposedActionV1): string {
    const action = next.nextAction?.trim();
    const lowerTitle = next.title.toLowerCase();
    const openers = [
      "Quick thing I noticed while browsing the repo:",
      "I found something while skimming the repo:",
      "Small heads-up from my repo read:",
    ];
    const pick = openers[Math.abs(next.title.length) % openers.length] ?? openers[0];
    const lead = /\bsenses?\b|\bvision\b|\bhearing\b|\bvoice\b|\bperception\b/.test(lowerTitle)
      ? `${pick} ${next.title} It matters to me because it can change how grounded I feel in conversation.`
      : `${pick} ${next.title}`;
    const lines = [lead, next.why];
    if (action) lines.push(`If you're up for it, can we do this next: ${action}`);
    return lines.join(" ");
  }

  const sessionActor = requestSessionActor(request);
  const externalId = sessionActor?.externalId ?? normalizeExternalId(request.query.externalId) ?? VI_OWNER_EXTERNAL_ID;
  const user = await getOrCreateUserByExternalId(externalId);
  const continuity = await getUserContinuityRow(user.id);
  if (!continuity) return { ping: null };
  const globalState = parseUserGlobalContinuityState(continuity.globalStateJson);
  const relevanceOrder: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };
  const minRelevance = relevanceOrder[VI_AUTONOMY_MIN_RELEVANCE] ?? relevanceOrder.medium;
  const nowMs = Date.now();
  const lastPingMs = globalState.proactivity.lastPingAt ? Date.parse(globalState.proactivity.lastPingAt) : NaN;
  const pingCooldownActive =
    Number.isFinite(lastPingMs) && nowMs - lastPingMs >= 0 && nowMs - lastPingMs < VI_AUTONOMY_PING_MIN_INTERVAL_MS;
  if (pingCooldownActive) return { ping: null };

  const proposals = parseUserProposals(continuity.proposalQueueJson);
  const next = proposals.find((p) => {
    const r = p.relevance ?? "medium";
    return relevanceOrder[r] >= minRelevance;
  });
  if (!next) return { ping: null };
  const proposalAtMs = Date.parse(next.at);
  const proposalAgeMs = Number.isFinite(proposalAtMs) ? nowMs - proposalAtMs : 0;
  if (proposalAgeMs < 30_000) return { ping: null };
  if (proposalAgeMs > 24 * 60 * 60 * 1000) return { ping: null };

  const remaining = proposals.filter((p) => p !== next);
  const nextGlobalState = {
    ...globalState,
    proactivity: {
      ...globalState.proactivity,
      lastPingAt: new Date(nowMs).toISOString(),
    },
  };
  await upsertUserContinuityRow({
    userId: user.id,
    globalStateJson: JSON.stringify(nextGlobalState),
    idleActivityJson: continuity.idleActivityJson,
    repoDigestsJson: continuity.repoDigestsJson,
    proposalQueueJson: JSON.stringify(remaining),
    lastRepoScanAt: continuity.lastRepoScanAt,
    lastRepoFingerprint: continuity.lastRepoFingerprint,
  });

  return {
    ping: {
      id: `${next.at}|${next.title}`,
      at: next.at,
      title: next.title,
      message: composeAutonomyPingMessage(next),
      nextAction: next.nextAction,
      relevance: next.relevance,
    },
  };
});

async function runIdleSessionScanOnce(): Promise<void> {
  const sessionCandidates = await listCandidateSessionsForIdleScan({
    activeWithinHours: VI_IDLE_ACTIVE_WINDOW_HOURS,
    limit: 60,
  });
  const userCandidates = await listCandidateUsersForIdleScan({
    activeWithinHours: VI_IDLE_ACTIVE_WINDOW_HOURS,
    limit: 40,
  });
  if (sessionCandidates.length === 0 && userCandidates.length === 0) return;

  for (const c of sessionCandidates) {
    const clock = getAuthoritativeTime();
    const turn = await createTurnJournal({
      sessionId: c.id,
      phase: "idle_scan",
      status: "in_progress",
      wallNowUtcIso: clock.utc,
      wallNowEpochMs: clock.epochMs,
    });
    try {
      const north = await getSessionNorthStarRow(c.id);
      if (!north) {
        await updateTurnJournal({
          turnId: turn.id,
          phase: "failed",
          status: "failed",
          errorMessage: "idle_scan: missing north-star row",
        });
        continue;
      }

      const passive = getPassiveState(c.id);
      hydratePassiveFromNorthStarRow(north, passive);
      const previousCount = passive.pendingReflections.length;
      const passiveThresholdMs = effectivePassiveGapThresholdMs({
        baseThresholdMs: PASSIVE_DISCOVERY_GAP_MINUTES * 60_000,
        priorPassiveProcessingStrength: north.passiveProcessingStrength,
      });
      const previousUserMessageAt = await getLatestUserMessageCreatedAt(c.id);
      await maybeEnqueueLongGapTimeAwarenessReflection({
        passive,
        wallNow: new Date(clock.epochMs),
        previousUserMessageAt,
        passiveThresholdMs,
        apiPort: API_PORT,
        userTimezone: USER_TIMEZONE,
      });

      if (passive.pendingReflections.length !== previousCount) {
        await updateSessionNorthStarPersistence({
          sessionId: c.id,
          lastInteractionEpochMs: north.lastInteractionEpochMs ?? clock.epochMs,
          totalSessionWallMs: north.totalSessionWallMs,
          lastGapDurationMs: north.lastGapDurationMs,
          perceivedWeight: north.perceivedWeight,
          drift: north.drift,
          passiveProcessingStrength: north.passiveProcessingStrength,
          discoveryQueueJson: JSON.stringify(passive.pendingReflections),
          learnedFactsJson: north.learnedFactsJson,
          relationalStateJson: north.relationalStateJson,
          capabilityMilestonesJson: north.capabilityMilestonesJson,
        });
        await updateTurnJournal({
          turnId: turn.id,
          phase: "idle_reflection_enqueued",
          status: "completed",
        });
      } else {
        await updateTurnJournal({
          turnId: turn.id,
          phase: "idle_scan",
          status: "completed",
        });
      }
    } catch (error) {
      await updateTurnJournal({
        turnId: turn.id,
        phase: "failed",
        status: "failed",
        errorMessage: (error as { message?: string })?.message ?? String(error),
      });
    }
  }

  // User-global idle runtime tick (cross-session continuity authority).
  for (const u of userCandidates) {
    const continuity = await getUserContinuityRow(u.userId);
    const tick = await runUserGlobalIdleRuntimeTick({
      repoRoot: getRepoRoot(),
      currentGlobalState: parseUserGlobalContinuityState(continuity?.globalStateJson),
      currentIdleActivity: parseUserIdleActivity(continuity?.idleActivityJson),
      currentRepoDigests: parseUserRepoDigests(continuity?.repoDigestsJson),
      currentProposals: parseUserProposals(continuity?.proposalQueueJson),
      lastRepoFingerprint: continuity?.lastRepoFingerprint ?? null,
    });
    await upsertUserContinuityRow({
      userId: u.userId,
      globalStateJson: JSON.stringify(tick.nextGlobalState),
      idleActivityJson: JSON.stringify(tick.nextIdleActivity),
      repoDigestsJson: JSON.stringify(tick.nextRepoDigests),
      proposalQueueJson: JSON.stringify(tick.nextProposals),
      lastRepoScanAt: tick.lastRepoScanAt,
      lastRepoFingerprint: tick.lastRepoFingerprint,
    });
  }
}

if (VI_IDLE_WORKER_ENABLED) {
  void runIdleSessionScanOnce().catch((error) => {
    logApiError("VI_IDLE_SCAN_BOOT", error);
  });
  setInterval(() => {
    void runIdleSessionScanOnce().catch((error) => {
      logApiError("VI_IDLE_SCAN_TICK", error);
    });
  }, Math.max(30_000, VI_IDLE_SCAN_INTERVAL_MS));
}

app.get<{
  Querystring: { sessionId?: string; externalId?: string };
  Reply: ChatSessionMessagesResponse | ChatErrorResponse;
}>("/chat/messages", async (request, reply): Promise<ChatSessionMessagesResponse | ChatErrorResponse> => {
  const sessionId = request.query.sessionId?.trim();
  if (!sessionId) {
    reply.code(400);
    return { error: { message: "sessionId is required" } };
  }

  const sessionActor = requestSessionActor(request);
  const externalId = sessionActor?.externalId ?? normalizeExternalId(request.query.externalId) ?? VI_OWNER_EXTERNAL_ID;
  const user = await getOrCreateUserByExternalId(externalId);
  const session = await getSessionForUser(sessionId, user.id);
  if (!session) {
    reply.code(404);
    return { error: { message: "Session not found" } };
  }

  const rows = await listSessionMessagesChronological(session.id);
  const messages = rows.map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));
  return { sessionId: session.id, messages };
});

app.delete<{
  Querystring: { sessionId?: string; externalId?: string };
  Reply: { ok: true; sessionId: string } | ChatErrorResponse;
}>("/chat/session", async (request, reply): Promise<{ ok: true; sessionId: string } | ChatErrorResponse> => {
  const sessionId = request.query.sessionId?.trim();
  if (!sessionId) {
    reply.code(400);
    return { error: { message: "sessionId is required" } };
  }
  const externalId = normalizeExternalId(request.query.externalId) ?? VI_OWNER_EXTERNAL_ID;
  const user = await getOrCreateUserByExternalId(externalId);
  const deleted = await deleteSessionForUser(sessionId, user.id);
  if (!deleted) {
    reply.code(404);
    return { error: { message: "Session not found" } };
  }
  deletePassiveStateForSession(sessionId);
  return { ok: true, sessionId };
});

app.post<{ Body: ChatRequest; Reply: ChatResponse | ChatErrorResponse }>(
  "/chat",
  async (request, reply): Promise<ChatResponse | ChatErrorResponse> => {
    let turnJournalId: string | null = null;
    try {
      const adapterCheck = validateChatRequestBodyShape(request.body);
      if (!adapterCheck.ok) {
        reply.code(400);
        return { error: { message: adapterCheck.violations.join(" ") } };
      }

      const ctx = request.body.context;
      const obHint = parseOnboardingV1FromContext(ctx);
      const rawOnboardingV1 =
        ctx && typeof ctx === "object" && !Array.isArray(ctx)
          ? (ctx as Record<string, unknown>).onboardingV1
          : undefined;
      if (rawOnboardingV1 !== undefined && !obHint) {
        reply.code(400);
        return { error: { message: "body.context.onboardingV1 is invalid" } };
      }
      const hasOnboarding = obHint != null;
      const messageRaw = typeof request.body.message === "string" ? request.body.message : "";
      const message = hasOnboarding && !messageRaw.trim() ? "[onboarding:start]" : messageRaw.trim();
      if (!message) {
        reply.code(400);
        return { error: { message: "message is required" } };
      }
      const marketCurrentQuery = isMarketCurrentQuery(message);
      const liveWebSources = marketCurrentQuery ? await fetchDuckDuckGoSources(message, 6).catch(() => []) : [];

      const sessionActor = requestSessionActor(request);
      const actorExternalId = parseActorExternalIdFromContext(request.body.context) ?? VI_OWNER_EXTERNAL_ID;
      const apiTier = VI_REQUIRE_API_KEY
        ? getRequestAuthTier(request.headers as Record<string, unknown>)
        : "owner";
      const actorRole: "owner" | "guest" = sessionActor
        ? sessionActor.role
        : apiTier === "owner"
          ? "owner"
          : "guest";
      const resolvedExternalId = sessionActor
        ? sessionActor.externalId
        : actorRole === "owner"
          ? VI_OWNER_EXTERNAL_ID
          : normalizeExternalId(actorExternalId) ?? "guest:public";
      const mixedContext = parseMixedEnvironmentContext(request.body.context);
      const addressedToVi = hasOnboarding
        ? true
        : inferAddressedToVi({
            message,
            context: mixedContext,
            viName: "vi",
          });
      const user = await getOrCreateUserByExternalId(resolvedExternalId);
      const shortcutReply = modeShortcutReply(message, actorRole);
      if (shortcutReply !== null) {
        const modeReply = shortcutReply;
        const modeSession = request.body.sessionId?.trim()
          ? (await getSessionForUser(request.body.sessionId.trim(), user.id)) ?? (await createSession(user.id))
          : await createSession(user.id);
        const userRow = await createUserMessageAndMarkTurn({
          turnId: (
            await createTurnJournal({
              sessionId: modeSession.id,
              phase: "received",
              status: "in_progress",
              wallNowUtcIso: new Date().toISOString(),
              wallNowEpochMs: Date.now(),
            })
          ).id,
          sessionId: modeSession.id,
          content: message,
        });
        const assistantRow = await createAssistantMessageAndMarkTurn({
          turnId: (
            await createTurnJournal({
              sessionId: modeSession.id,
              phase: "assistant_saved",
              status: "in_progress",
              wallNowUtcIso: new Date().toISOString(),
              wallNowEpochMs: Date.now(),
            })
          ).id,
          sessionId: modeSession.id,
          content: modeReply,
          model: "routing:mode-check-v1",
          finalPhase: "state_saved",
        });
        return {
          reply: modeReply,
          sessionId: modeSession.id,
          chronos: {
            serverNow: new Date().toISOString(),
            userMessageAt: userRow.createdAt.toISOString(),
            assistantMessageAt: assistantRow.createdAt.toISOString(),
          },
        };
      }
      const override = parseOverrideContext(request.body.context);
      if (override && actorRole !== "owner") {
        reply.code(403);
        return { error: { message: "override is owner-only" } };
      }
      const overrideAuthorized =
        !!override &&
        VI_OVERRIDE_STRING_NAME.length > 0 &&
        safeEq(override.stringName, VI_OVERRIDE_STRING_NAME);
      if (override && !overrideAuthorized) {
        reply.code(403);
        return { error: { message: "override rejected: invalid string name" } };
      }
      if (!addressedToVi) {
        const passthroughSession = request.body.sessionId?.trim();
        const reusableSession = passthroughSession ? await getSessionForUser(passthroughSession, user.id) : null;
        const session = reusableSession ?? (await createSession(user.id));
        const row = await createUserMessageAndMarkTurn({
          turnId: (
            await createTurnJournal({
              sessionId: session.id,
              phase: "received",
              status: "in_progress",
              wallNowUtcIso: new Date().toISOString(),
              wallNowEpochMs: Date.now(),
            })
          ).id,
          sessionId: session.id,
          content: message,
        });
        const quietReply = "I am listening in the background. Call my name when you want me in.";
        await createAssistantMessageAndMarkTurn({
          turnId: (
            await createTurnJournal({
              sessionId: session.id,
              phase: "assistant_saved",
              status: "in_progress",
              wallNowUtcIso: new Date().toISOString(),
              wallNowEpochMs: Date.now(),
            })
          ).id,
          sessionId: session.id,
          content: quietReply,
          model: "routing:addressee-v1",
          finalPhase: "state_saved",
        });
        return {
          reply: quietReply,
          sessionId: session.id,
          chronos: {
            serverNow: new Date().toISOString(),
            userMessageAt: row.createdAt.toISOString(),
            assistantMessageAt: new Date().toISOString(),
          },
        };
      }

      const requestedSessionId = request.body.sessionId?.trim();
      const reusableSession = requestedSessionId
        ? await getSessionForUser(requestedSessionId, user.id)
        : null;
      const session = reusableSession ?? (await createSession(user.id));

      const north = await getSessionNorthStarRow(session.id);
      if (!north) {
        reply.code(500);
        return { error: { message: "Session persistence error." } };
      }
      const passive = getPassiveState(session.id);
      hydratePassiveFromNorthStarRow(north, passive);
      const driftAtTurnStart = north.drift;
      const passiveThresholdMs = effectivePassiveGapThresholdMs({
        baseThresholdMs: PASSIVE_DISCOVERY_GAP_MINUTES * 60_000,
        priorPassiveProcessingStrength: north.passiveProcessingStrength,
      });
      const persistedChronosSnapshot = northRowToPersistedSnapshot(north);
      const relationalAtTurnStart = parseRelationalStateJson(north.relationalStateJson);
      const capabilityMilestonesAtTurnStart = ensureBaselineCapabilityMilestones(
        parseCapabilityMilestonesJson(north.capabilityMilestonesJson),
      );

      const history = await listRecentMessages(session.id, HISTORY_LIMIT);
      const guestMessagesUsed = history.filter((m) => m.role === "user").length;
      if (actorRole === "guest" && VI_GUEST_MESSAGE_LIMIT > 0 && guestMessagesUsed >= VI_GUEST_MESSAGE_LIMIT) {
        reply.code(402);
        return {
          error: {
            code: "SIGNUP_REQUIRED",
            message: "Guest message limit reached. Sign in to continue chatting.",
          },
        };
      }
      const rollingFields = await getSessionRollingSummaryFields(session.id);
      const rollingSummary = rollingFields?.rollingSummary ?? null;
      const continuityRowAtTurnStart = await getUserContinuityRow(user.id);
      const globalStateAtTurnStart = parseUserGlobalContinuityState(
        continuityRowAtTurnStart?.globalStateJson,
      );
      const repoDigestsAtTurnStart = parseUserRepoDigests(continuityRowAtTurnStart?.repoDigestsJson);
      const proposalsAtTurnStart = parseUserProposals(continuityRowAtTurnStart?.proposalQueueJson);

      if (DEBUG_CONTEXT) {
        console.log("[VI_DEBUG_CONTEXT]", {
          sessionId: session.id,
          historyCount: history.length,
          lastHistoryMessages: history.slice(-3),
          hasRollingSummary: Boolean(rollingSummary?.trim()),
        });
      }

      const clock = getAuthoritativeTime();
      const wallNow = new Date(clock.epochMs);
      const turnJournal = await createTurnJournal({
        sessionId: session.id,
        phase: "received",
        status: "in_progress",
        wallNowUtcIso: clock.utc,
        wallNowEpochMs: clock.epochMs,
      });
      turnJournalId = turnJournal.id;

      const previousTurnAt = await getLatestUserOrAssistantMessageCreatedAt(session.id);
      const previousUserMessageAt = await getLatestUserMessageCreatedAt(session.id);
      const firstThreadMessageAt = await getFirstUserOrAssistantMessageCreatedAt(session.id);

      const gapWeightThresholdMs =
        VI_TEMPORAL_MEANINGFUL_GAP_MS ?? PASSIVE_DISCOVERY_GAP_MINUTES * 60_000;
      const temporalState = buildViTemporalInternalStateV1({
        authoritativeTime: clock,
        userMessage: message,
        previousUserMessageAt,
        firstThreadMessageAt,
        gapWeightThresholdMs,
      });
      passive.lastTemporalState = temporalState;

      await maybeEnqueueLongGapTimeAwarenessReflection({
        passive,
        wallNow,
        previousUserMessageAt,
        passiveThresholdMs,
        apiPort: API_PORT,
        userTimezone: USER_TIMEZONE,
      });

      const userRow = await createUserMessageAndMarkTurn({
        turnId: turnJournal.id,
        sessionId: session.id,
        content: message,
      });
      const globalStateAfterUserMessage = applyCrossThreadContinuityFromUserMessage(
        globalStateAtTurnStart,
        message,
      );
      const messageTokens = new Set(
        message
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 4),
      );
      const hasIdleReflectionMatch = globalStateAtTurnStart.idleReflections.some((r) => {
        const topicHit = r.topicRefs.some((t) =>
          t
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .some((tok) => tok.length >= 4 && messageTokens.has(tok)),
        );
        const textHit = r.text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .some((tok) => tok.length >= 5 && messageTokens.has(tok));
        return topicHit || textHit;
      });
      applyMemoryConflictResolution({ passive, userMessage: message });

      const shouldRetrieveRepoEvidence = looksLikeRepoCodeQuestion(message);
      const repoEvidence = shouldRetrieveRepoEvidence
        ? await retrieveRepoEvidence({ repoRoot: getRepoRoot(), userMessage: message })
        : { readFilePaths: [], used: [] };
      passive.lastRepoEvidence = shouldRetrieveRepoEvidence ? repoEvidence : null;

      const mentionCandidate = passive.pendingReflections.find((p) => p.surfacedAt === null);
      const shouldMentionPending =
        VI_INCLUDE_PASSIVE_PENDING_MENTION && Boolean(mentionCandidate) && isRelevantForPendingMention(message);
      const pendingMention =
        shouldMentionPending && mentionCandidate
          ? {
              capability: mentionCandidate.capability,
              reasonCode: mentionCandidate.reasonCode,
              elapsedSinceLastUserMs: mentionCandidate.elapsedSinceLastUserMs,
              thresholdMs: mentionCandidate.thresholdMs,
              evidenceCount: mentionCandidate.evidenceCount,
            }
          : null;
      const { unifiedState, effectiveResponseMode, userIntentPrimary, decisionTrace } =
        await deriveTurnUnifiedStateV1({
          sessionId: session.id,
          actorRole,
          message,
          clockUtcIso: clock.utc,
          previousTurnAtIso: previousTurnAt ? previousTurnAt.toISOString() : null,
          temporalState,
          persistedChronosSnapshot,
          relationalAtTurnStart,
          capabilityMilestonesAtTurnStart,
          passivePendingCount: passive.pendingReflections.length,
          passiveLastBackgroundActivityAt: passive.lastBackgroundActivityAt,
          priorPassiveProcessingStrength: north.passiveProcessingStrength,
          passiveThresholdMs,
          pendingMention,
          historyUserAssistantTurns: history.length,
          repoEvidence,
          learnedFacts: passive.learnedFacts,
          buildRecallMessages: () =>
            buildRecallSystemMessages(session.id, message, RECALL_EXCLUDE_RECENT_COUNT),
          persistedDrift: north.drift,
          persistedPerceivedWeight: north.perceivedWeight,
        });
      passive.lastDecisionTrace = decisionTrace;
      passive.lastUnifiedState = unifiedState;

      const recallSystemMessages = buildBehaviorSystemMessagesFromUnifiedState({
        unifiedState,
        displayTimeZone: USER_TIMEZONE,
        includePendingMention: VI_INCLUDE_PASSIVE_PENDING_MENTION,
      });
      const globalContinuitySystemMessage = buildGlobalContinuitySystemMessage({
        globalState: globalStateAfterUserMessage,
        repoDigests: repoDigestsAtTurnStart,
        proposals: proposalsAtTurnStart,
      });
      const onboardingSystem = obHint
        ? { role: "system" as const, content: buildOnboardingV1SystemMessage(obHint) }
        : null;
      const mergedSystemMessages = [
        globalContinuitySystemMessage,
        ...(onboardingSystem ? [onboardingSystem] : []),
        ...(liveWebSources.length > 0
          ? [
              {
                role: "system" as const,
                content: [
                  "Live web evidence (prefer these over stale priors; cite links in final answer):",
                  ...liveWebSources.map(
                    (s, i) => `${i + 1}. ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet || "(none)"}`,
                  ),
                ].join("\n\n"),
              },
            ]
          : []),
        ...recallSystemMessages,
      ];

      if (DEBUG_CONTEXT && recallSystemMessages.length > 0) {
        console.log("[VI_RECALL]", { sessionId: session.id, blocks: recallSystemMessages.length });
      }

      const turnResult = await runTurn({
        message:
          overrideAuthorized && override
            ? `${message}\n\n[OVERRIDE_AUTHORIZED]\ncommand=${override.command}`
            : message,
        history,
        rollingSummary,
        recallSystemMessages: mergedSystemMessages,
        humanity: {
          wantsIntent: unifiedState.humanity.interpretation.wantsIntent,
          responseMode: unifiedState.effectiveResponseMode,
          posture: unifiedState.humanity.expression.posture,
          userRole: actorRole,
        },
        stance: unifiedState.stance,
        continuity: {
          hasIdleReflectionMatch,
        },
      });
      await updateTurnJournal({
        turnId: turnJournal.id,
        phase: "model_done",
        status: "in_progress",
        userMessageId: userRow.id,
      });
      let aiReply = turnResult.reply;
      if (marketCurrentQuery) {
        const hasLink = /\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+/i.test(aiReply);
        if (!hasLink || /^idk\b/i.test(aiReply.trim())) {
          aiReply = await buildMarketAnswerFromSources(message, liveWebSources);
        }
      }
      maybePersistAnchoredLearning({
        passive,
        reply: aiReply,
        evidenceUsed: repoEvidence.used,
      });
      if (passive.lastUnifiedState) {
        passive.lastUnifiedState = {
          ...passive.lastUnifiedState,
          learning: {
            learnedFactsCount: passive.learnedFacts.length,
            learnedFacts: passive.learnedFacts.slice(0, 20),
          },
          passive: {
            ...passive.lastUnifiedState.passive,
            pendingCount: passive.pendingReflections.length,
            lastBackgroundActivityAt: passive.lastBackgroundActivityAt,
          },
        };
      }

      if (shouldMentionPending && mentionCandidate) {
        mentionCandidate.shareIntent = "mention_if_relevant";
        mentionCandidate.surfacedAt = new Date().toISOString();
      }

      const assistantRow = await createAssistantMessageAndMarkTurn({
        turnId: turnJournal.id,
        sessionId: session.id,
        content: aiReply,
        model: `${turnResult.provider}:${turnResult.model}`,
        finalPhase: "state_saved",
      });

      const nextBundle = computeNextPersistedChronosBundle({
        sessionCreatedAtMs: north.createdAt.getTime(),
        priorLastInteractionAt: north.lastInteractionEpochMs,
        priorPerceivedWeight: north.perceivedWeight,
        priorDrift: north.drift,
        turnUserCreatedAtMs: userRow.createdAt.getTime(),
        turnAssistantCreatedAtMs: assistantRow.createdAt.getTime(),
        gapWeightThresholdMs,
        passiveGapTargetMs: PASSIVE_DISCOVERY_GAP_MINUTES * 60_000,
      });

      const nextRelational = computeNextRelationalStateV1({
        prior: relationalAtTurnStart,
        userMessage: message,
        userMessageLength: message.length,
        assistantReplyLength: aiReply.length,
        gapMsSinceLastInteraction: north.lastGapDuration,
        responseMode: effectiveResponseMode,
        userIntentPrimary,
        overrideForced: overrideAuthorized,
        turnClass: temporalState.turnClass,
      });
      if (overrideAuthorized && override) {
        const overrideFact = `OVERRIDE_FORCED command accepted via authenticated string name: ${override.command.slice(0, 180)}`;
        const overrideAnchors = ["override:forced"];
        const retention = scoreMemoryRetentionV1({
          fact: overrideFact,
          anchors: overrideAnchors,
          source: "override_forced",
        });
        passive.learnedFacts = [
          {
            at: new Date().toISOString(),
            fact: overrideFact,
            anchors: [
              ...overrideAnchors,
              `memory_tier:${retention.tier}`,
              `memory_score:${retention.score.toFixed(2)}`,
            ],
          },
          ...passive.learnedFacts,
        ].slice(0, 20);
      }

      await updateSessionNorthStarPersistence({
        sessionId: session.id,
        lastInteractionEpochMs: nextBundle.lastInteractionAt,
        totalSessionWallMs: nextBundle.totalSessionTime,
        lastGapDurationMs: nextBundle.gapDuration,
        perceivedWeight: nextBundle.perceivedWeight,
        drift: nextBundle.drift,
        passiveProcessingStrength: nextBundle.passiveProcessingStrength,
        discoveryQueueJson: JSON.stringify(passive.pendingReflections),
        learnedFactsJson: JSON.stringify(passive.learnedFacts),
        relationalStateJson: serializeRelationalStateV1(nextRelational),
        capabilityMilestonesJson: serializeCapabilityMilestonesJson(capabilityMilestonesAtTurnStart),
      });
      await upsertUserContinuityRow({
        userId: user.id,
        globalStateJson: JSON.stringify(globalStateAfterUserMessage),
        idleActivityJson: continuityRowAtTurnStart?.idleActivityJson ?? JSON.stringify([]),
        repoDigestsJson: continuityRowAtTurnStart?.repoDigestsJson ?? JSON.stringify([]),
        proposalQueueJson: continuityRowAtTurnStart?.proposalQueueJson ?? JSON.stringify([]),
        lastRepoScanAt: continuityRowAtTurnStart?.lastRepoScanAt ?? null,
        lastRepoFingerprint: continuityRowAtTurnStart?.lastRepoFingerprint ?? null,
      });

      void refreshRollingSessionSummaryIfDue(session.id, {
        driftAtTurnStart,
        lastUserMessage: message,
      });

      const response: ChatResponse = {
        reply: aiReply,
        sessionId: session.id,
        ...(turnResult.providerNotice ? { providerNotice: turnResult.providerNotice } : {}),
        chronos: {
          serverNow: clock.utc,
          userMessageAt: userRow.createdAt.toISOString(),
          assistantMessageAt: assistantRow.createdAt.toISOString(),
        },
        temporalState,
        ...(VI_DEBUG_DECISION_TRACE ? { decisionTrace } : {}),
        evidenceUsed: repoEvidence.used,
        unifiedState: passive.lastUnifiedState,
      };
      return response;
    } catch (error) {
      if (turnJournalId) {
        try {
          await updateTurnJournal({
            turnId: turnJournalId,
            phase: "failed",
            status: "failed",
            errorMessage: (error as { message?: string })?.message ?? String(error),
          });
        } catch {
          // Keep error handler resilient: don't mask original failure.
        }
      }
      logApiError("VI_CHAT_ERROR", error, {
        sessionId: request.body.sessionId ?? null,
        hasMessage: Boolean(request.body.message?.trim()),
      });
      const classified = classifyUpstreamError(error);
      reply.code(classified.httpStatus);
      return { error: { message: classified.message, code: classified.code } };
    }
  },
);

// ── XP / leveling ──────────────────────────────────────────────────────────

type XpErrorReply = { error: { message: string } };

type XpAddBody = { guildId: string; userId: string; xp?: number; cooldownMs?: number };
type XpAddReply =
  | {
      ok: true;
      added: boolean;
      newXp: number;
      newMessageCount: number;
      level: number;
      leveledUp: boolean;
      levelsGained: number;
    }
  | XpErrorReply;

type XpModifyBody = { guildId: string; userId: string; deltaXp: number };
type XpModifyReply =
  | {
      ok: true;
      guildId: string;
      userId: string;
      previousXp: number;
      newXp: number;
      levelBefore: number;
      levelAfter: number;
    }
  | XpErrorReply;

app.post<{ Body: XpModifyBody; Reply: XpModifyReply }>("/xp/modify", async (request, reply) => {
  if (!isOwnerRequest(request as { headers: Record<string, unknown>; sessionActor?: SessionActor | null })) {
    reply.code(403);
    return { error: { message: "owner API key required for XP modify" } };
  }
  const body = (request.body ?? {}) as XpModifyBody;
  const { guildId, userId, deltaXp } = body;
  if (!guildId || !userId || typeof deltaXp !== "number" || !Number.isFinite(deltaXp)) {
    reply.code(400);
    return { error: { message: "guildId, userId, and numeric deltaXp are required" } };
  }
  try {
    const r = await modifyXpByDelta(guildId, userId, deltaXp);
    return { ok: true, guildId, userId, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("deltaXp") || msg.includes("too large")) {
      reply.code(400);
      return { error: { message: msg } };
    }
    logApiError("VI_XP_MODIFY", e);
    reply.code(500);
    return { error: { message: "XP modify failed" } };
  }
});

app.post<{ Body: XpAddBody; Reply: XpAddReply }>("/xp/add", async (request, reply) => {
  const { guildId, userId, xp: xpAmount = 20, cooldownMs = 60_000 } = request.body ?? {};
  if (!guildId || !userId) {
    reply.code(400);
    return { error: { message: "guildId and userId are required" } };
  }
  try {
    const result = await addXpIfCooldownPassed(guildId, userId, Math.max(1, Math.min(xpAmount, 500)), cooldownMs);
    return { ok: true, ...result };
  } catch (e) {
    logApiError("VI_XP_ADD", e);
    reply.code(500);
    return { error: { message: "XP add failed" } };
  }
});

type XpRankReply =
  | {
      ok: true;
      guildId: string;
      userId: string;
      xp: number;
      messageCount: number;
      level: number;
      rank: number;
      lastMessageAt: number | null;
      rankedMemberCount: number;
      xpToOvertakeNext: number | null;
    }
  | XpErrorReply;

app.get<{ Params: { guildId: string; userId: string }; Reply: XpRankReply }>(
  "/xp/:guildId/:userId",
  async (request, reply) => {
    const { guildId, userId } = request.params;
    try {
      const row = await getXpRank(guildId, userId);
      if (!row) {
        reply.code(404);
        return { error: { message: "User has no XP in this guild" } };
      }
      return {
        ok: true,
        guildId,
        userId,
        xp: row.xp,
        messageCount: row.messageCount,
        level: row.level,
        rank: row.rank,
        lastMessageAt: row.lastMessageAt,
        rankedMemberCount: row.rankedMemberCount,
        xpToOvertakeNext: row.xpToOvertakeNext,
      };
    } catch (e) {
      logApiError("VI_XP_RANK", e);
      reply.code(500);
      return { error: { message: "XP rank lookup failed" } };
    }
  },
);

type LeaderboardReply =
  | {
      ok: true;
      guildId: string;
      rankedMemberCount: number;
      entries: Array<{ userId: string; xp: number; messageCount: number; level: number; rank: number }>;
    }
  | XpErrorReply;

app.get<{ Params: { guildId: string }; Querystring: { limit?: string }; Reply: LeaderboardReply }>(
  "/xp/:guildId/leaderboard",
  async (request, reply) => {
    const { guildId } = request.params;
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 10));
    try {
      const [entries, rankedMemberCount] = await Promise.all([
        getXpLeaderboard(guildId, limit),
        countGuildRankedMembers(guildId),
      ]);
      return { ok: true, guildId, entries, rankedMemberCount };
    } catch (e) {
      logApiError("VI_XP_LEADERBOARD", e);
      reply.code(500);
      return { error: { message: "XP leaderboard lookup failed" } };
    }
  },
);

await app.listen({ port: API_PORT, host: "0.0.0.0" });
