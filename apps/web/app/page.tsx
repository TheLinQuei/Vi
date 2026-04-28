"use client";

import type {
  ChatHistoryMessage,
  ChatResponse,
  ChatSessionMessagesResponse,
  ChatTurnChronos,
  ViDecisionTraceV1,
  ViRepoEvidenceDebugV1,
  ViRepoEvidenceItemV1,
  ViPersistedChronosSnapshotV1,
  ViRelationalStateV1,
  ViTemporalInternalStateV1,
  ViUnifiedStateV1,
} from "@vi/shared";
import Link from "next/link";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatElapsedMs } from "../lib/formatElapsed";
import {
  applyTimeAwarenessEvidence,
  advanceCurrentCapability,
  approveReflection,
  currentCapability,
  defaultDiscoveryState,
  type DiscoveryStatus,
  lastCompletedReflection,
  loadDiscoveryState,
  nextQueuedCapability,
  saveDiscoveryState,
  startNextCapability,
  type TimeAwarenessEvidenceSnapshot,
  type DiscoveryState,
} from "../lib/selfModelDiscovery";
import {
  dedupeSessionsById,
  defaultSessionsState,
  loadSessionsState,
  migrateLegacySessionId,
  removeSessionById,
  saveSessionsState,
  truncatePreview,
  upsertSession,
  type ViSessionsStateV1,
} from "../lib/viSessions";

type ChatMessage = ChatHistoryMessage;

type ChatError = {
  error: {
    message: string;
    code?: "UPSTREAM_QUOTA_LIMIT" | "UPSTREAM_RATE_LIMIT" | "INTERNAL_ERROR" | "SIGNUP_REQUIRED";
  };
};

function getChatErrorMessage(
  response: Response,
  data: ChatResponse | ChatError | null,
  raw: string,
): string {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    data.error &&
    typeof data.error === "object"
  ) {
    const code = (data.error as { code?: unknown }).code;
    const msg = (data.error as { message?: unknown }).message;
    if (code === "UPSTREAM_QUOTA_LIMIT") {
      return "Provider credits/spending limit reached. Update billing or limit, then retry.";
    }
    if (code === "UPSTREAM_RATE_LIMIT") {
      return "Provider rate limit hit. Wait a moment and retry.";
    }
    if (code === "SIGNUP_REQUIRED") {
      return "Guest limit reached. Sign in is required for more messages.";
    }
    if (typeof msg === "string" && msg.trim().length > 0) return msg;
  }
  if (raw.trim().length > 0) {
    return `Request failed (${response.status}). ${raw.slice(0, 180)}`;
  }
  return `Request failed (${response.status} ${response.statusText || "Unknown"}). No response body.`;
}

type PassivePendingReflection = {
  id: string;
  capability: string;
  createdAt: string;
  reasonCode: "long_gap_time_awareness_check";
  elapsedSinceLastUserMs: number;
  thresholdMs: number;
  evidenceCount: number;
  shareIntent: "silent" | "mention_if_relevant";
  surfacedAt: string | null;
};

type PassiveDiscoveryStateResponse = {
  thresholdMinutes: number;
  lastBackgroundActivityAt: string | null;
  pendingReflections: PassivePendingReflection[];
  temporalState: ViTemporalInternalStateV1 | null;
  decisionTrace: ViDecisionTraceV1 | null;
  repoEvidence: ViRepoEvidenceDebugV1 | null;
  learnedFacts: Array<{ at: string; fact: string; anchors: string[] }>;
  unifiedState: ViUnifiedStateV1 | null;
  persistedChronos: ViPersistedChronosSnapshotV1 | null;
  relationalState: ViRelationalStateV1 | null;
  globalContinuity?: {
    countToTenProgress: number | null;
    recentRepoDigests: Array<{ at: string; filePath: string; summary: string; retentionTier: string }>;
    proposedActions: Array<{ at: string; title: string; why: string }>;
    idleReflections?: Array<{ at: string; text: string; source: string; confidence: string }>;
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

type PendingAutonomyPing = {
  id: string;
  at: string;
  title: string;
  message: string;
  nextAction?: string;
  relevance?: "low" | "medium" | "high";
  stage: 0 | 1 | 2;
};

const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const API_BASE_URL =
  envBase && envBase.length > 0 ? envBase.replace(/\/$/, "") : "http://127.0.0.1:3001";
const API_KEY = process.env.NEXT_PUBLIC_VI_API_KEY?.trim() ?? "";
const ACTOR_EXTERNAL_ID = process.env.NEXT_PUBLIC_ACTOR_EXTERNAL_ID?.trim() ?? "owner:you";
const GUEST_MESSAGE_LIMIT = Math.max(1, Number(process.env.NEXT_PUBLIC_GUEST_MESSAGE_LIMIT ?? "8"));
const IS_PUBLIC_GUEST_CLIENT = /^vi_pub_/i.test(API_KEY);

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  return headers;
}

function isSessionNotFound(res: Response, data: ChatSessionMessagesResponse | ChatError): boolean {
  return (
    res.status === 404 &&
    "error" in data &&
    typeof data.error?.message === "string" &&
    data.error.message === "Session not found"
  );
}

function previewFromMessages(msgs: ChatMessage[]): string {
  const first = msgs.find((m) => m.role === "user");
  return truncatePreview(first?.content ?? "…");
}

function threadFirstMessageMs(msgs: ChatMessage[]): number | null {
  const times = msgs
    .map((m) => (m.createdAt ? Date.parse(m.createdAt) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return Math.min(...times);
}

export default function Page() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sessionState, setSessionState] = useState<ViSessionsStateV1>(defaultSessionsState);
  const [isLoading, setIsLoading] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authMe, setAuthMe] = useState<AuthMeResponse["user"]>(null);
  const [pendingAutonomyPing, setPendingAutonomyPing] = useState<PendingAutonomyPing | null>(null);
  const [persistReady, setPersistReady] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [hasMounted, setHasMounted] = useState(false);
  const [lastTurnChronos, setLastTurnChronos] = useState<ChatTurnChronos | null>(null);
  const [lastTemporalState, setLastTemporalState] = useState<ViTemporalInternalStateV1 | null>(null);
  const [lastDecisionTrace, setLastDecisionTrace] = useState<ViDecisionTraceV1 | null>(null);
  const [lastEvidenceUsed, setLastEvidenceUsed] = useState<ViRepoEvidenceItemV1[]>([]);
  const [lastUnifiedState, setLastUnifiedState] = useState<ViUnifiedStateV1 | null>(null);
  const [showOperatorPanels, setShowOperatorPanels] = useState(false);
  const [discoveryPanelTab, setDiscoveryPanelTab] = useState<"passive_now" | "history">(
    "passive_now",
  );
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>(defaultDiscoveryState);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [passiveDiscovery, setPassiveDiscovery] = useState<PassiveDiscoveryStateResponse | null>(null);
  const hydrateGen = useRef(0);
  const seenAutonomyPingIdsRef = useRef<Set<string>>(new Set());
  const chatScrollRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const discoveryStateRef = useRef(discoveryState);
  discoveryStateRef.current = discoveryState;

  const activeSessionId = sessionState.activeSessionId;

  const threadAnchorMs = useMemo(() => threadFirstMessageMs(messages), [messages]);

  const canSend = useMemo(
    () => text.trim().length > 0 && !isLoading && historyReady,
    [text, isLoading, historyReady],
  );
  const guestMessagesSent = useMemo(
    () => messages.filter((m) => m.role === "user").length,
    [messages],
  );

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, { credentials: "include", cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as AuthMeResponse;
          setAuthMe(body.user ?? null);
        } else {
          setAuthMe(null);
        }
      } catch {
        setAuthMe(null);
      } finally {
        setAuthReady(true);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!hasMounted) return;
    const id = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasMounted]);

  useEffect(() => {
    if (!persistReady) return;
    saveSessionsState(sessionState);
  }, [sessionState, persistReady]);

  useEffect(() => {
    const stored = loadDiscoveryState();
    setDiscoveryState(stored ?? defaultDiscoveryState());
  }, []);

  useEffect(() => {
    saveDiscoveryState(discoveryState);
  }, [discoveryState]);

  useEffect(() => {
    if (!historyReady) return;
    const viewport = chatScrollRef.current;
    if (!viewport) return;
    const raf = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [messages, isLoading, historyReady, activeSessionId]);

  const fetchPassiveDiscoveryState = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setPassiveDiscovery(null);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE_URL}/self-model/state?sessionId=${encodeURIComponent(sessionId)}&externalId=${encodeURIComponent(ACTOR_EXTERNAL_ID)}`,
        {
          cache: "no-store",
          credentials: "include",
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as PassiveDiscoveryStateResponse;
      setPassiveDiscovery(data);
      setLastTemporalState(data.temporalState ?? null);
      setLastDecisionTrace(data.decisionTrace ?? null);
      setLastEvidenceUsed(data.repoEvidence?.used ?? []);
      setLastUnifiedState(data.unifiedState ?? null);
    } catch {
      // Silent in v1.1: passive panel is observability only.
    }
  }, []);

  const fetchAutonomyPing = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/self-model/autonomy-ping?externalId=${encodeURIComponent(ACTOR_EXTERNAL_ID)}`,
        {
          cache: "no-store",
          credentials: "include",
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as AutonomyPingResponse;
      if (!data.ping) return;
      const ping = data.ping;
      if (seenAutonomyPingIdsRef.current.has(ping.id)) return;
      seenAutonomyPingIdsRef.current.add(ping.id);
      // Stage proactive notes across normal chat turns instead of blurting full reports.
      setPendingAutonomyPing({
        id: ping.id,
        at: ping.at,
        title: ping.title,
        message: ping.message,
        nextAction: ping.nextAction,
        relevance: ping.relevance,
        stage: 0,
      });
    } catch {
      // Best-effort bounded autonomy ping.
    }
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    void fetchAutonomyPing();
    const id = window.setInterval(() => {
      void fetchAutonomyPing();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [historyReady, fetchAutonomyPing]);

  const fetchMessagesForSession = useCallback(
    async (sessionId: string): Promise<{ ok: true; data: ChatSessionMessagesResponse } | { ok: false; notFound: boolean }> => {
      const res = await fetch(
        `${API_BASE_URL}/chat/messages?sessionId=${encodeURIComponent(sessionId)}&externalId=${encodeURIComponent(ACTOR_EXTERNAL_ID)}`,
        {
          cache: "no-store",
          credentials: "include",
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
        },
      );
      let data: ChatSessionMessagesResponse | ChatError;
      try {
        data = (await res.json()) as ChatSessionMessagesResponse | ChatError;
      } catch {
        return { ok: false, notFound: false };
      }
      if (!res.ok) {
        return { ok: false, notFound: isSessionNotFound(res, data) };
      }
      if (!("messages" in data)) {
        return { ok: false, notFound: false };
      }
      return { ok: true, data };
    },
    [],
  );

  const hydrateActiveChain = useCallback(
    async (gen: number, initial: ViSessionsStateV1): Promise<void> => {
      let state: ViSessionsStateV1 = {
        ...initial,
        sessions: dedupeSessionsById(initial.sessions),
      };
      let targetId: string | null = state.activeSessionId;

      while (targetId) {
        const result = await fetchMessagesForSession(targetId);
        if (gen !== hydrateGen.current) return;

        if (result.ok) {
          const preview = previewFromMessages(result.data.messages);
          state = {
            ...state,
            activeSessionId: result.data.sessionId,
            sessions: upsertSession(state.sessions, result.data.sessionId, preview),
          };
          setSessionState(state);
          setMessages(result.data.messages);
          setLastTurnChronos(null);
          setLastTemporalState(null);
          setLastDecisionTrace(null);
          setLastEvidenceUsed([]);
          setLastUnifiedState(null);
          void fetchPassiveDiscoveryState(result.data.sessionId);
          setHistoryReady(true);
          setPersistReady(true);
          return;
        }

        if (result.notFound) {
          const sessions = removeSessionById(state.sessions, targetId);
          const nextActive = sessions[0]?.id ?? null;
          state = { ...state, sessions, activeSessionId: nextActive };
          setSessionState(state);
          setError("A saved conversation no longer exists and was removed from the list.");
          targetId = nextActive;
          continue;
        }

        setSessionState(state);
        setError("Could not load conversation history.");
        setHistoryReady(true);
        setPersistReady(true);
        return;
      }

      setSessionState(state);
      setMessages([]);
      setLastTurnChronos(null);
      setLastTemporalState(null);
      setLastDecisionTrace(null);
      setLastEvidenceUsed([]);
      setLastUnifiedState(null);
      void fetchPassiveDiscoveryState(null);
      setHistoryReady(true);
      setPersistReady(true);
    },
    [fetchMessagesForSession],
  );

  useEffect(() => {
    const gen = ++hydrateGen.current;
    const initial = loadSessionsState() ?? migrateLegacySessionId() ?? defaultSessionsState();
    const merged: ViSessionsStateV1 = {
      ...initial,
      sessions: dedupeSessionsById(initial.sessions),
    };
    setSessionState(merged);
    void hydrateActiveChain(gen, merged);
  }, [hydrateActiveChain]);

  function startNewConversation() {
    hydrateGen.current += 1;
    setError(null);
    setProviderNotice(null);
    setText("");
    setIsLoading(false);
    setMessages([]);
    setLastTurnChronos(null);
    setLastTemporalState(null);
    setLastDecisionTrace(null);
    setLastEvidenceUsed([]);
    setLastUnifiedState(null);
    setPassiveDiscovery(null);
    setSessionState((prev) => ({
      version: 1,
      activeSessionId: null,
      sessions: dedupeSessionsById(prev.sessions),
    }));
    setHistoryReady(true);
  }

  async function switchToSession(sessionId: string) {
    const gen = ++hydrateGen.current;
    setError(null);
    setText("");
    setIsLoading(false);
    setLastTurnChronos(null);
    setLastTemporalState(null);
    setLastDecisionTrace(null);
    setLastEvidenceUsed([]);
    setLastUnifiedState(null);
    setHistoryReady(false);

    const snapshot = sessionStateRef.current;
    let state: ViSessionsStateV1 = {
      ...snapshot,
      activeSessionId: sessionId,
      sessions: dedupeSessionsById(snapshot.sessions),
    };
    setSessionState(state);

    let targetId: string | null = sessionId;

    while (targetId) {
      const result = await fetchMessagesForSession(targetId);
      if (gen !== hydrateGen.current) return;

      if (result.ok) {
        const preview = previewFromMessages(result.data.messages);
        state = {
          ...state,
          activeSessionId: result.data.sessionId,
          sessions: upsertSession(state.sessions, result.data.sessionId, preview),
        };
        setSessionState(state);
        setMessages(result.data.messages);
        void fetchPassiveDiscoveryState(result.data.sessionId);
        setHistoryReady(true);
        return;
      }

      if (result.notFound) {
        const sessions = removeSessionById(state.sessions, targetId);
        const nextActive = sessions[0]?.id ?? null;
        state = { ...state, sessions, activeSessionId: nextActive };
        setSessionState(state);
        setError("That conversation no longer exists. Removed from the list.");
        targetId = nextActive;
        continue;
      }

      setSessionState(state);
      setError("Could not load conversation history.");
      setHistoryReady(true);
      return;
    }

    setSessionState(state);
    setMessages([]);
    setLastTemporalState(null);
    setLastDecisionTrace(null);
    setLastEvidenceUsed([]);
    void fetchPassiveDiscoveryState(null);
    setHistoryReady(true);
  }

  async function deleteSession(sessionId: string) {
    if (!historyReady || isLoading) return;
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/chat/session?sessionId=${encodeURIComponent(sessionId)}&externalId=${encodeURIComponent(ACTOR_EXTERNAL_ID)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
        },
      );
      const raw = await res.text();
      let data: { ok: true; sessionId: string } | ChatError | null = null;
      try {
        data = raw ? (JSON.parse(raw) as { ok: true; sessionId: string } | ChatError) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const msg =
          data && "error" in data
            ? data.error.message
            : `Delete failed (${res.status}). ${raw.slice(0, 160) || "No response body."}`;
        setError(msg);
        return;
      }

      setSessionState((prev) => {
        const sessions = removeSessionById(prev.sessions, sessionId);
        const activeSessionId =
          prev.activeSessionId === sessionId ? (sessions[0]?.id ?? null) : prev.activeSessionId;
        return { ...prev, sessions, activeSessionId };
      });

      const wasActive = sessionStateRef.current.activeSessionId === sessionId;
      if (wasActive) {
        setMessages([]);
        setLastTurnChronos(null);
        setLastTemporalState(null);
        setLastDecisionTrace(null);
        setLastEvidenceUsed([]);
        setLastUnifiedState(null);
        void fetchPassiveDiscoveryState(null);
      }
    } catch {
      setError("Could not delete session.");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = text.replace(/\r\n/g, "\n");
    if (!normalized.trim() || isLoading || !historyReady) return;
    if (IS_PUBLIC_GUEST_CLIENT && guestMessagesSent >= GUEST_MESSAGE_LIMIT) {
      setShowSignupModal(true);
      return;
    }
    const message = normalized;
    const q = message.toLowerCase();

    setError(null);
    const priorActive = sessionStateRef.current.activeSessionId;
    const clientSendAt = new Date().toISOString();
    setText("");
    setMessages((prev) => [...prev, { role: "user", content: message, createdAt: clientSendAt }]);
    setIsLoading(true);

    try {
      const payload: { message: string; sessionId?: string; context: { actorExternalId: string } } = {
        message,
        context: { actorExternalId: ACTOR_EXTERNAL_ID },
      };
      if (priorActive) payload.sessionId = priorActive;

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        credentials: "include",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      let data: ChatResponse | ChatError | null = null;
      try {
        data = raw ? (JSON.parse(raw) as ChatResponse | ChatError) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        if (data && typeof data === "object" && "error" in data && data.error?.code === "SIGNUP_REQUIRED") {
          setShowSignupModal(true);
        }
        const messageText = getChatErrorMessage(response, data, raw);
        setError(messageText);
        console.error("[Vi chat error]", {
          status: response.status,
          statusText: response.statusText,
          parsed: data,
          body: raw || "(empty)",
          headers: Object.fromEntries(response.headers.entries()),
          apiBaseUrl: API_BASE_URL,
        });
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last?.role === "user" && last.content === message) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        return;
      }

      if (!data || !("reply" in data) || !("sessionId" in data)) {
        setError(`Invalid response from API (${response.status}).`);
        console.error("[Vi chat invalid response]", {
          status: response.status,
          body: raw,
          apiBaseUrl: API_BASE_URL,
        });
        return;
      }

      const success = data as ChatResponse;
      setProviderNotice(success.providerNotice ?? null);
      if (success.chronos) {
        console.info("[Vi chronos] turn", success.chronos);
      }
      if (success.temporalState) {
        console.info("[Vi temporalState] turn", success.temporalState);
      }

      setSessionState((prev) => ({
        version: 1,
        activeSessionId: success.sessionId,
        sessions: upsertSession(prev.sessions, success.sessionId, message),
      }));
      void fetchPassiveDiscoveryState(success.sessionId);

      setLastTurnChronos(success.chronos ?? null);
      setLastTemporalState(success.temporalState ?? null);
      setLastDecisionTrace(success.decisionTrace ?? null);
      setLastEvidenceUsed(success.evidenceUsed ?? []);
      setLastUnifiedState(success.unifiedState ?? null);

      const userAt = success.chronos?.userMessageAt ?? clientSendAt;
      const assistantAt = success.chronos?.assistantMessageAt ?? new Date().toISOString();
      const socialCheck = /\b(how are you|what'?s up|what are you doing|you okay|you good)\b/i.test(q);
      const interestCheck = /\b(anything interesting|find anything|what did you find|what happened|interesting)\b/i.test(
        q,
      );
      const nextStepCheck = /\b(what should we do|what next|where should i look|show me|help me)\b/i.test(q);
      let stagedFollowUp: ChatMessage | null = null;
      let nextPingState: PendingAutonomyPing | null = pendingAutonomyPing;

      if (pendingAutonomyPing?.stage === 0 && socialCheck) {
        stagedFollowUp = {
          role: "assistant",
          content: "I am okay. I was lazily skimming my repo while things were quiet.",
          createdAt: new Date().toISOString(),
        };
        nextPingState = { ...pendingAutonomyPing, stage: 1 };
      } else if (pendingAutonomyPing?.stage === 1 && interestCheck) {
        const firstBeat = pendingAutonomyPing.message.split(". ").slice(0, 1).join(". ").trim();
        stagedFollowUp = {
          role: "assistant",
          content: firstBeat.length > 0 ? firstBeat : pendingAutonomyPing.title,
          createdAt: new Date().toISOString(),
        };
        nextPingState = { ...pendingAutonomyPing, stage: 2 };
      } else if (pendingAutonomyPing?.stage === 2 && nextStepCheck) {
        stagedFollowUp = {
          role: "assistant",
          content: pendingAutonomyPing.nextAction
            ? `If you are up for it, could you do this: ${pendingAutonomyPing.nextAction}`
            : "If you are up for it, can we take a closer look together?",
          createdAt: new Date().toISOString(),
        };
        nextPingState = null;
      }

      setMessages((prev) => {
        const base =
          prev.length > 0 &&
          prev[prev.length - 1]?.role === "user" &&
          prev[prev.length - 1].content === message
            ? prev.slice(0, -1)
            : prev;
        const nextMessages: ChatMessage[] = [
          ...base,
          { role: "user", content: message, createdAt: userAt },
          { role: "assistant", content: success.reply, createdAt: assistantAt },
        ];
        if (stagedFollowUp) nextMessages.push(stagedFollowUp);

        return nextMessages;
      });
      if (nextPingState !== pendingAutonomyPing) setPendingAutonomyPing(nextPingState);
    } catch {
      setError("Could not reach the API.");
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last?.role === "user" && last.content === message) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function logout(): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    setAuthMe(null);
  }

  async function advanceDiscoveryStep() {
    const current = currentCapability(discoveryStateRef.current);
    if (!current) return;
    if (discoveryBusy) return;

    if (current.id === "cap-time-awareness" && current.status === "reading") {
      setDiscoveryBusy(true);
      try {
        const res = await fetch(`${API_BASE_URL}/self-model/evidence/time-awareness`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          let detail = "";
          try {
            detail = await res.text();
          } catch {
            detail = "";
          }
          const suffix = detail ? ` (${res.status}: ${detail.slice(0, 180)})` : ` (${res.status})`;
          setError(`Self-model evidence fetch failed${suffix}. Verify API restart and base URL.`);
          return;
        }
        const snapshot = (await res.json()) as TimeAwarenessEvidenceSnapshot;
        setDiscoveryState((prev) => applyTimeAwarenessEvidence(prev, snapshot));
      } catch {
        setError("Self-model evidence fetch failed (network). Verify API restart and base URL.");
      } finally {
        setDiscoveryBusy(false);
      }
      return;
    }

    if (current.status === "reading") {
      setError(
        `Current reading packet (${current.capability}) is not wired for bounded evidence in this version. Reset discovery state by reloading after update.`,
      );
      return;
    }

    setDiscoveryState((prev) => advanceCurrentCapability(prev));
  }

  const deviceTimeLabel = new Date(clockTick).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const threadElapsedLabel =
    threadAnchorMs !== null
      ? formatElapsedMs(clockTick - threadAnchorMs)
      : "— (send a message to anchor DB time)";

  const discoveryCurrent = currentCapability(discoveryState);
  const discoveryNext = nextQueuedCapability(discoveryState);
  const discoveryLast = lastCompletedReflection(discoveryState);
  const approvedCount = discoveryState.queue.filter((q) => q.status === "approved").length;
  const reflectedCount = discoveryState.queue.filter((q) => q.status === "reflected").length;
  const totalCount = discoveryState.queue.length;
  const discoveryEvidenceCoverage = discoveryCurrent
    ? `${discoveryCurrent.evidenceReadCount}/${discoveryCurrent.evidenceFiles.length}`
    : "—";

  const canApproveCurrent =
    Boolean(discoveryCurrent) && (discoveryCurrent?.status as DiscoveryStatus) === "reflected";

  const passivePendingCount = passiveDiscovery?.pendingReflections.length ?? 0;
  const liveStateLabel = useMemo(() => {
    if (isLoading) return "thinking";
    if ((passiveDiscovery?.repoEvidence?.readFilePaths.length ?? 0) > 0 && lastEvidenceUsed.length > 0) {
      return "reading";
    }
    if (passivePendingCount > 0) return "reflecting";
    if (discoveryCurrent) return "learning";
    return "idle";
  }, [isLoading, passiveDiscovery?.repoEvidence?.readFilePaths.length, lastEvidenceUsed.length, passivePendingCount, discoveryCurrent]);
  const unifiedQuickView = useMemo(() => {
    if (!lastUnifiedState) return null;
    const humanity = lastUnifiedState.humanity;
    return {
      wantsIntent: humanity.interpretation.wantsIntent,
      responseMode: humanity.decision.responseMode,
      activeTraits: humanity.interpretation.activeTraitIds,
      stanceStrength: humanity.decision.stanceStrength,
      repoUsed: lastUnifiedState.repo.usedEvidenceCount,
      learnedFacts: lastUnifiedState.learning.learnedFactsCount,
      turnClass: lastUnifiedState.temporal.turnClass,
      gapBand: lastUnifiedState.decision.gapWeightBand,
    };
  }, [lastUnifiedState]);
  const groupedMessages = useMemo(() => {
    const groups: Array<{ role: "user" | "assistant"; items: ChatMessage[] }> = [];
    for (const msg of messages) {
      const last = groups[groups.length - 1];
      if (!last || last.role !== msg.role) groups.push({ role: msg.role, items: [msg] });
      else last.items.push(msg);
    }
    return groups;
  }, [messages]);

  if (!authReady) {
    return <main style={{ maxWidth: 920, margin: "24px auto", padding: 16 }}>Loading...</main>;
  }

  if (!authMe) {
    return (
      <main style={{ maxWidth: 920, margin: "24px auto", padding: 16 }}>
        <h1>Vi Chat</h1>
        <p>Sign up or log in to continue.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/login" style={{ padding: "10px 12px", border: "1px solid #334155", borderRadius: 8 }}>
            Log in
          </Link>
          <Link href="/signup" style={{ padding: "10px 12px", border: "1px solid #334155", borderRadius: 8 }}>
            Sign up
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        display: "grid",
        gridTemplateColumns: showOperatorPanels ? "260px minmax(0, 1fr) 360px" : "minmax(0, 1fr)",
        gap: 14,
        maxWidth: 1400,
        margin: "0 auto",
        padding: 14,
        alignItems: "stretch",
        height: "calc(100vh - 28px)",
        overflow: "hidden",
      }}
    >
      {showOperatorPanels ? (
        <aside
          style={{
            border: "1px solid #2a2f39",
            borderRadius: 12,
            padding: 10,
            backgroundColor: "#121722",
            height: "100%",
            minHeight: 0,
          }}
        >
        <button
          type="button"
          onClick={startNewConversation}
          style={{
            width: "100%",
            padding: "10px 12px",
            cursor: "pointer",
            fontWeight: 700,
            borderRadius: 8,
            border: "1px solid #4b5563",
            background: "#d1d5db",
            color: "#111827",
          }}
        >
          New conversation
        </button>
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 10, marginBottom: 8, fontWeight: 700 }}>
          Sessions
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: "86vh" }}>
          {sessionState.sessions.length === 0 ? (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>None yet</span>
          ) : (
            sessionState.sessions.map((s) => {
              const isActive = activeSessionId === s.id;
              return (
                <div
                  key={s.id}
                  style={{
                    border: isActive ? "1px solid #93c5fd" : "1px solid #374151",
                    borderRadius: 8,
                    background: isActive ? "#1f2937" : "#111827",
                    color: "#f9fafb",
                    fontSize: 12,
                    padding: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => void switchToSession(s.id)}
                      disabled={!historyReady || isLoading}
                      style={{
                        textAlign: "left",
                        cursor: historyReady && !isLoading ? "pointer" : "not-allowed",
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        padding: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{ fontWeight: isActive ? 700 : 500, wordBreak: "break-word", lineHeight: 1.3 }}
                      >
                        {s.preview}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSession(s.id)}
                      disabled={!historyReady || isLoading}
                      title="Delete chat"
                      style={{
                        border: "1px solid #475569",
                        borderRadius: 6,
                        background: "#0b1220",
                        color: "#cbd5e1",
                        fontSize: 11,
                        lineHeight: 1,
                        padding: "4px 6px",
                        cursor: historyReady && !isLoading ? "pointer" : "not-allowed",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <div style={{ color: "#9ca3af", marginTop: 4, fontSize: 11 }}>
                    {hasMounted ? new Date(s.updatedAt).toLocaleString() : "—"}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
      ) : null}

      <section
        style={{
          border: "1px solid #2a2f39",
          borderRadius: 12,
          padding: 12,
          backgroundColor: "#0f141d",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h1 style={{ margin: "2px 0 8px 0" }}>Vi Chat</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span
              style={{
                fontSize: 11,
                border: "1px solid #334155",
                borderRadius: 999,
                padding: "3px 8px",
                color: "#cbd5e1",
                background: "#0b1220",
              }}
              title="Vi passive activity state"
            >
              {liveStateLabel}
            </span>
            {unifiedQuickView ? (
              <>
                <span
                  style={{
                    fontSize: 11,
                    border: "1px solid #334155",
                    borderRadius: 999,
                    padding: "3px 8px",
                    color: "#cbd5e1",
                    background: "#0b1220",
                  }}
                  title="Humanity wants intent"
                >
                  intent: {unifiedQuickView.wantsIntent}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    border: "1px solid #334155",
                    borderRadius: 999,
                    padding: "3px 8px",
                    color: "#cbd5e1",
                    background: "#0b1220",
                  }}
                  title="Humanity response mode"
                >
                  mode: {unifiedQuickView.responseMode}
                </span>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void logout()}
              style={{
                fontSize: 12,
                border: "1px solid #475569",
                borderRadius: 8,
                padding: "6px 10px",
                background: "#111827",
                color: "#e2e8f0",
                cursor: "pointer",
              }}
              title="Log out"
            >
              Log out
            </button>
            <button
              type="button"
              onClick={() => setShowOperatorPanels((v) => !v)}
              style={{
                fontSize: 12,
                border: "1px solid #475569",
                borderRadius: 8,
                padding: "6px 10px",
                background: "#111827",
                color: "#e2e8f0",
                cursor: "pointer",
              }}
              title="Open/close operator panels"
            >
              {showOperatorPanels ? "Hide menu" : "Menu"}
            </button>
          </div>
        </div>
        {activeSessionId === null ? (
          <p style={{ color: "#9ca3af", marginTop: 0, fontSize: 14 }}>
            New conversation - your next message starts a fresh session. Old sessions stay in the list.
          </p>
        ) : (
          <p style={{ color: "#9ca3af", marginTop: 0, fontSize: 12, wordBreak: "break-all" }}>
            Active session: {activeSessionId}
          </p>
        )}
        <p style={{ color: "#9ca3af", marginTop: 0, fontSize: 12 }}>
          Signed in as: {authMe.email ?? authMe.externalId} ({authMe.role})
        </p>

        <section
          ref={chatScrollRef}
          style={{
            flex: 1,
            border: "1px solid #293140",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            backgroundColor: "#0b1018",
            overflowY: "auto",
          }}
        >
          {!historyReady ? (
            <p style={{ color: "#9ca3af", margin: 0 }}>Loading conversation...</p>
          ) : messages.length === 0 ? (
            <p style={{ color: "#9ca3af", margin: 0 }}>Start the conversation.</p>
          ) : (
            groupedMessages.map((group, groupIdx) => (
              <div
                key={`${group.role}-${groupIdx}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: group.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4, fontWeight: 700 }}>
                  {group.role === "user" ? "You" : "Vi"}
                </div>
                {group.items.map((messageItem, itemIdx) => (
                  <div
                    key={`${groupIdx}-${itemIdx}`}
                    style={{
                      maxWidth: "82%",
                      borderRadius: 12,
                      padding: "9px 11px",
                      background: group.role === "user" ? "#1d4ed8" : "#1f2937",
                      color: "#f9fafb",
                      marginTop: itemIdx === 0 ? 0 : 6,
                      border: group.role === "user" ? "1px solid #2563eb" : "1px solid #374151",
                      lineHeight: 1.35,
                    }}
                  >
                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        lineHeight: 1.5,
                      }}
                    >
                      {messageItem.content}
                    </div>
                    {messageItem.createdAt && hasMounted ? (
                      <div style={{ color: "#cbd5e1", fontSize: 10, marginTop: 4 }}>
                        {new Date(messageItem.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
          {isLoading ? <p style={{ marginBottom: 0, color: "#9ca3af" }}>Thinking...</p> : null}
        </section>

        <form
          onSubmit={onSubmit}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 8,
            background: "#111827",
          }}
        >
          <textarea
            ref={composerRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Say something..."
            rows={1}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #374151",
              background: "#0f172a",
              color: "#f9fafb",
              resize: "none",
              lineHeight: 1.45,
              maxHeight: 220,
              overflowY: "auto",
            }}
            disabled={!historyReady}
          />
          <button
            type="submit"
            disabled={!canSend}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #2563eb",
              background: "#1d4ed8",
              color: "white",
              fontWeight: 700,
            }}
          >
            Send
          </button>
        </form>
        {error ? <p style={{ color: "#fca5a5", marginBottom: 0 }}>{error}</p> : null}
        {providerNotice ? <p style={{ color: "#fbbf24", marginBottom: 0 }}>{providerNotice}</p> : null}
        {IS_PUBLIC_GUEST_CLIENT ? (
          <p style={{ color: "#94a3b8", marginBottom: 0, fontSize: 12 }}>
            Guest messages used: {Math.min(guestMessagesSent, GUEST_MESSAGE_LIMIT)}/{GUEST_MESSAGE_LIMIT}
          </p>
        ) : null}
      </section>

      {showSignupModal ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.72)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "min(480px, 100%)",
              border: "1px solid #334155",
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              padding: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, color: "#f8fafc" }}>Sign-in required</h2>
            <p style={{ marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
              You have used {GUEST_MESSAGE_LIMIT} guest messages. Sign-in flow is the next step; once it is wired, this
              will route you there.
            </p>
            <button
              type="button"
              onClick={() => setShowSignupModal(false)}
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #475569",
                background: "#111827",
                color: "#e2e8f0",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {showOperatorPanels ? (
        <aside
          style={{
            border: "1px solid #2a2f39",
            borderRadius: 12,
            padding: 10,
            backgroundColor: "#121722",
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
        <section
          style={{
            fontSize: 12,
            color: "#dbe2f0",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 10,
            backgroundColor: "#0f172a",
            lineHeight: 1.5,
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 14, color: "#f3f4f6" }}>Chronos</h2>
          <div>
            <strong>Your device:</strong> {hasMounted ? deviceTimeLabel : "-"}
          </div>
          <div style={{ marginTop: 2 }}>
            <strong>Thread span:</strong>{" "}
            {hasMounted ? threadElapsedLabel : threadAnchorMs !== null ? "-" : "- (await first message)"}
          </div>
          {lastTurnChronos ? (
            <div style={{ marginTop: 4, color: "#9ca3af", fontSize: 11 }}>
              user @{lastTurnChronos.userMessageAt}
              <br />
              assistant @{lastTurnChronos.assistantMessageAt}
              <br />
              server @{lastTurnChronos.serverNow}
            </div>
          ) : (
            <div style={{ marginTop: 4, color: "#9ca3af", fontSize: 11 }}>Turn timestamps appear after reply.</div>
          )}
        </section>

        <section
          style={{
            fontSize: 12,
            color: "#dbe2f0",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 10,
            backgroundColor: "#0f172a",
            lineHeight: 1.5,
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#cbd5e1" }}>77EZ Unified State</h2>
          {lastUnifiedState ? (
            <>
              <div>
                <strong>wantsIntent:</strong> {lastUnifiedState.humanity.interpretation.wantsIntent}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>responseMode:</strong> {lastUnifiedState.humanity.decision.responseMode}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>aligned intent:</strong> {lastUnifiedState.alignedInterpretation.intentType} |{" "}
                <strong>relationalCtx:</strong> {lastUnifiedState.alignedInterpretation.relationalContext} |{" "}
                <strong>sig:</strong> {lastUnifiedState.alignedInterpretation.significance.toFixed(2)}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>stance:</strong> {lastUnifiedState.stance.direction} (
                {lastUnifiedState.stance.strength.toFixed(2)}, {lastUnifiedState.stance.justificationSource})
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>relational:</strong> f={lastUnifiedState.relational.familiarity.toFixed(2)} t=
                {lastUnifiedState.relational.trustWeight.toFixed(2)} e=
                {lastUnifiedState.relational.engagementTrend.toFixed(2)}
              </div>
              {lastUnifiedState.decision.phase2 ? (
                <div style={{ marginTop: 2 }}>
                  <strong>phase2 chronos shaping:</strong>{" "}
                  {lastUnifiedState.decision.phase2.chronosEngagementShaping.toFixed(2)}
                </div>
              ) : null}
              <div style={{ marginTop: 2 }}>
                <strong>activeTraits:</strong>{" "}
                {lastUnifiedState.humanity.interpretation.activeTraitIds.length > 0
                  ? lastUnifiedState.humanity.interpretation.activeTraitIds.join(", ")
                  : "none"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>stanceStrength:</strong>{" "}
                {lastUnifiedState.humanity.decision.stanceStrength.toFixed(2)}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>turnClass / gapBand:</strong> {lastUnifiedState.temporal.turnClass} /{" "}
                {lastUnifiedState.decision.gapWeightBand}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>repo used:</strong> {lastUnifiedState.repo.usedEvidenceCount} | <strong>learned:</strong>{" "}
                {lastUnifiedState.learning.learnedFactsCount}
              </div>
            </>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: 11 }}>
              No unified-state snapshot yet. Send a message.
            </div>
          )}
        </section>

        <section
          style={{
            fontSize: 12,
            color: "#dbe2f0",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 10,
            backgroundColor: "#0f172a",
            lineHeight: 1.5,
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#cbd5e1" }}>Repo Evidence (debug)</h2>
          <div>
            <strong>read:</strong> {passiveDiscovery?.repoEvidence?.readFilePaths.length ?? 0}
          </div>
          <div style={{ marginTop: 2 }}>
            <strong>used:</strong> {lastEvidenceUsed.length}
          </div>
          {lastEvidenceUsed.length > 0 ? (
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {lastEvidenceUsed.slice(0, 4).map((e, idx) => (
                <li key={`${e.filePath}-${idx}`} style={{ marginBottom: 4 }}>
                  <div style={{ color: "#cbd5e1" }}>{e.filePath}</div>
                  <div style={{ color: "#9ca3af", fontSize: 11 }}>
                    score {e.relevanceScore} - {e.snippet.slice(0, 90).replace(/\s+/g, " ")}
                    {e.snippet.length > 90 ? "…" : ""}
                  </div>
                  {e.whySelected ? (
                    <div style={{ color: "#94a3b8", fontSize: 10 }}>
                      why: tokens[{e.whySelected.tokenHits.join(", ") || "-"}] hs[
                      {e.whySelected.highSignalHits.join(", ") || "-"}] sym=
                      {String(e.whySelected.symbolHintHit)} path={String(e.whySelected.pathHintHit)} type=
                      {e.whySelected.fileTypeBoost}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 4 }}>No repo evidence used this turn.</div>
          )}
          <div style={{ marginTop: 6, color: "#9ca3af", fontSize: 11 }}>
            learned facts: {passiveDiscovery?.learnedFacts.length ?? 0}
          </div>
        </section>

        <section
          style={{
            fontSize: 12,
            color: "#dbe2f0",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 10,
            backgroundColor: "#0f172a",
            lineHeight: 1.5,
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#cbd5e1" }}>Decision Trace (debug)</h2>
          {lastDecisionTrace ? (
            <>
              <div>
                <strong>turnClass:</strong> {lastDecisionTrace.turnClass}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>gapWeightBand:</strong> {lastDecisionTrace.gapWeightBand}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>brevityTarget:</strong> {lastDecisionTrace.responsePolicy.brevityTarget}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>followUpQuestionLikelihood:</strong>{" "}
                {lastDecisionTrace.responsePolicy.followUpQuestionLikelihood}
              </div>
            </>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: 11 }}>No decision trace yet. Send a message.</div>
          )}
        </section>

        <section
          style={{
            fontSize: 12,
            color: "#dbe2f0",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 10,
            backgroundColor: "#0f172a",
            lineHeight: 1.5,
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 13, color: "#cbd5e1" }}>Temporal State (debug)</h2>
          {lastTemporalState ? (
            <>
              <div>
                <strong>gapSinceLastUserMs:</strong>{" "}
                {lastTemporalState.gapSinceLastUserMs === null ? "null" : lastTemporalState.gapSinceLastUserMs}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>gapNormalizedWeight:</strong> {lastTemporalState.gapNormalizedWeight.toFixed(3)}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>threadSpanMs:</strong>{" "}
                {lastTemporalState.threadSpanMs === null ? "null" : lastTemporalState.threadSpanMs}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>turnClass:</strong> {lastTemporalState.turnClass}
              </div>
            </>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: 11 }}>No temporal state yet. Send a message.</div>
          )}
        </section>

        <section
          style={{
            fontSize: 12,
            color: "#dbe2f0",
            border: "1px solid #2f3a4f",
            borderRadius: 10,
            padding: 10,
            backgroundColor: "#0f172a",
            lineHeight: 1.5,
            flex: 1,
            overflowY: "auto",
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 14, color: "#f3f4f6" }}>Self-Model Discovery</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setDiscoveryPanelTab("passive_now")}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #475569",
                background: discoveryPanelTab === "passive_now" ? "#1f2937" : "#0f172a",
                color: "#e2e8f0",
                fontSize: 11,
              }}
            >
              Passive now
            </button>
            <button
              type="button"
              onClick={() => setDiscoveryPanelTab("history")}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #475569",
                background: discoveryPanelTab === "history" ? "#1f2937" : "#0f172a",
                color: "#e2e8f0",
                fontSize: 11,
              }}
            >
              History
            </button>
          </div>

          {discoveryPanelTab === "passive_now" ? (
            <>
              <div>
                <strong>Current:</strong> {discoveryCurrent ? discoveryCurrent.capability : "None active"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Status:</strong> {discoveryCurrent?.status ?? "idle"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Next queued:</strong> {discoveryNext?.capability ?? "None"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Evidence:</strong> {discoveryCurrent ? `${discoveryEvidenceCoverage} files` : "-"}
              </div>
              <div style={{ marginTop: 2, color: "#9ca3af" }}>
                <strong>Queue:</strong> {approvedCount} approved - {reflectedCount} reflected - {totalCount} total
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Last background activity:</strong>{" "}
                {passiveDiscovery?.lastBackgroundActivityAt
                  ? new Date(passiveDiscovery.lastBackgroundActivityAt).toLocaleString()
                  : "none yet"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Pending (unshared):</strong> {passivePendingCount}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Repo reads/used:</strong>{" "}
                {(passiveDiscovery?.repoEvidence?.readFilePaths.length ?? 0)}/{lastEvidenceUsed.length}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Anchored learned facts:</strong> {passiveDiscovery?.learnedFacts.length ?? 0}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Idle active heartbeat:</strong>{" "}
                {passiveDiscovery?.globalContinuity ? "alive" : "warming up"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Cross-thread carry (count):</strong>{" "}
                {passiveDiscovery?.globalContinuity?.countToTenProgress ?? "-"}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>Latest repo digest:</strong>{" "}
                {passiveDiscovery?.globalContinuity?.recentRepoDigests?.[0]
                  ? `${passiveDiscovery.globalContinuity.recentRepoDigests[0].filePath} (${passiveDiscovery.globalContinuity.recentRepoDigests[0].retentionTier})`
                  : "none yet"}
              </div>
              <div style={{ marginTop: 2, color: "#9ca3af" }}>
                <strong>Share intent:</strong> mention only if relevant
              </div>
              {passiveDiscovery?.globalContinuity?.proposedActions?.length ? (
                <div style={{ marginTop: 8 }}>
                  <strong>Proposed next actions:</strong>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                    {passiveDiscovery.globalContinuity.proposedActions.slice(0, 3).map((p) => (
                      <li key={`${p.at}-${p.title}`}>{p.title}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {passiveDiscovery?.globalContinuity?.idleReflections?.length ? (
                <div style={{ marginTop: 8 }}>
                  <strong>Idle reflections (grounded):</strong>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                    {passiveDiscovery.globalContinuity.idleReflections.slice(0, 3).map((r) => (
                      <li key={`${r.at}-${r.text}`}>{r.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {passiveDiscovery && passiveDiscovery.pendingReflections.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <strong>Pending queue:</strong>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                    {passiveDiscovery.pendingReflections.slice(0, 3).map((p) => (
                      <li key={p.id}>
                        {new Date(p.createdAt).toLocaleTimeString()} - {p.capability} - evidence {p.evidenceCount}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setDiscoveryState((prev) => startNextCapability(prev))}
                  disabled={discoveryBusy}
                  style={{ padding: "6px 10px", borderRadius: 6 }}
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={() => void advanceDiscoveryStep()}
                  disabled={discoveryBusy || !discoveryCurrent}
                  style={{ padding: "6px 10px", borderRadius: 6 }}
                >
                  {discoveryBusy ? "Loading..." : "Advance"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDiscoveryState((prev) =>
                      discoveryCurrent ? approveReflection(prev, discoveryCurrent.id) : prev,
                    )
                  }
                  disabled={!canApproveCurrent || discoveryBusy}
                  style={{ padding: "6px 10px", borderRadius: 6 }}
                >
                  Approve
                </button>
              </div>

              {discoveryCurrent?.evidenceDetails && discoveryCurrent.evidenceDetails.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <strong>Evidence basis:</strong>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                    {discoveryCurrent.evidenceDetails.slice(0, 6).map((line, idx) => (
                      <li key={`${discoveryCurrent.id}-e-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div style={{ marginTop: 10 }}>
                <strong>Last completed reflection:</strong>
                {discoveryLast?.reflection ? (
                  <div
                    style={{
                      marginTop: 4,
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: 8,
                      background: "#111827",
                    }}
                  >
                    <div>
                      <strong>{discoveryLast.reflection.capability}</strong> ({discoveryLast.status})
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <strong>State:</strong> {discoveryLast.reflection.current_state}
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <strong>Preference:</strong> {discoveryLast.reflection.preference} -{" "}
                      <strong>Confidence:</strong> {discoveryLast.reflection.confidence}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 4, color: "#9ca3af" }}>No reflection completed yet.</div>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <strong>Activity feed:</strong>
                {discoveryState.activity.length === 0 ? (
                  <div style={{ marginTop: 4, color: "#9ca3af" }}>
                    No activity yet. Start next capability to begin bounded discovery.
                  </div>
                ) : (
                  <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                    {discoveryState.activity.slice(0, 8).map((a, idx) => (
                      <li key={`${a.at}-${idx}`} style={{ marginBottom: 2 }}>
                        [{new Date(a.at).toLocaleTimeString()}] {a.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </aside>
      ) : null}
    </main>
  );
}
