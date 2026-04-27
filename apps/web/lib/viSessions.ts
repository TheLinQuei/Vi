export const VI_SESSIONS_STORAGE_KEY = "vi.session.v1";
/** Legacy single-id key — migrated once into structured storage */
export const VI_LEGACY_SESSION_ID_KEY = "vi.sessionId";

export type ViSessionEntry = {
  id: string;
  preview: string;
  updatedAt: string;
};

export type ViSessionsStateV1 = {
  version: 1;
  /** null = next POST omits sessionId (new branch). */
  activeSessionId: string | null;
  /** Most recently touched first. */
  sessions: ViSessionEntry[];
};

const MAX_PREVIEW_CHARS = 72;

export function truncatePreview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_PREVIEW_CHARS) return t || "…";
  return `${t.slice(0, MAX_PREVIEW_CHARS - 1)}…`;
}

export function loadSessionsState(): ViSessionsStateV1 | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(VI_SESSIONS_STORAGE_KEY);
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ViSessionsStateV1>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return null;
    return {
      version: 1,
      activeSessionId:
        typeof parsed.activeSessionId === "string" || parsed.activeSessionId === null
          ? parsed.activeSessionId
          : null,
      sessions: parsed.sessions
        .filter((s): s is ViSessionEntry => typeof s?.id === "string" && s.id.length > 0)
        .map((s) => ({
          id: s.id,
          preview: typeof s.preview === "string" ? s.preview : "…",
          updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date().toISOString(),
        })),
    };
  } catch {
    return null;
  }
}

export function saveSessionsState(state: ViSessionsStateV1): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VI_SESSIONS_STORAGE_KEY, JSON.stringify(state));
}

/** One-time migration from vi.sessionId string. */
export function migrateLegacySessionId(): ViSessionsStateV1 | null {
  if (typeof window === "undefined") return null;
  const legacy = window.localStorage.getItem(VI_LEGACY_SESSION_ID_KEY)?.trim();
  if (!legacy) return null;
  const now = new Date().toISOString();
  const state: ViSessionsStateV1 = {
    version: 1,
    activeSessionId: legacy,
    sessions: [{ id: legacy, preview: "…", updatedAt: now }],
  };
  window.localStorage.removeItem(VI_LEGACY_SESSION_ID_KEY);
  saveSessionsState(state);
  return state;
}

export function defaultSessionsState(): ViSessionsStateV1 {
  return { version: 1, activeSessionId: null, sessions: [] };
}

export function dedupeSessionsById(sessions: ViSessionEntry[]): ViSessionEntry[] {
  const seen = new Set<string>();
  const out: ViSessionEntry[] = [];
  for (const s of sessions) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function removeSessionById(sessions: ViSessionEntry[], id: string): ViSessionEntry[] {
  return sessions.filter((s) => s.id !== id);
}

export function upsertSession(
  sessions: ViSessionEntry[],
  id: string,
  preview: string,
  touchIso?: string,
): ViSessionEntry[] {
  const now = touchIso ?? new Date().toISOString();
  const rest = sessions.filter((s) => s.id !== id);
  return [{ id, preview: truncatePreview(preview), updatedAt: now }, ...rest];
}
