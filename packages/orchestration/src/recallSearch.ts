import {
  countSessionMessages,
  listRecentMessageIdsForSession,
  searchSessionMessageArchive,
} from "@vi/db";

/** User message rows in the live prompt = last HISTORY_LIMIT before turn + current user line (already persisted). */
export const RECALL_EXCLUDE_RECENT_COUNT = 21;

const RECALL_REGEXES = [
  /\bwhat (did|do) i (say|tell)\b/i,
  /\bwhat did i say (my|your|about|when|why|how)\b/i,
  /\bwhat was i (saying|talking about)\b/i,
  /\b(didn'?t|did not) i (already )?tell you\b/i,
  /\b(have i|did i already) tell you\b/i,
  /\b(do you|can you) remember\b/i,
  /\bremind me\b/i,
  /\bwhat (was|were) .{0,40}\babout again\b/i,
  /\bearlier (today|this week|when|about)\b/i,
  /\blast (week|time|we talked)\b/i,
  /\bwhat .{0,30}(codename|nickname)\b/i,
];

const STOPWORDS = new Set(
  [
    "the",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "for",
    "and",
    "or",
    "but",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "i",
    "me",
    "my",
    "mine",
    "you",
    "your",
    "yours",
    "we",
    "our",
    "us",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "what",
    "which",
    "who",
    "whom",
    "how",
    "why",
    "when",
    "where",
    "do",
    "did",
    "does",
    "have",
    "has",
    "had",
    "not",
    "no",
    "so",
    "if",
    "as",
    "at",
    "by",
    "from",
    "with",
    "just",
    "like",
    "really",
    "very",
    "something",
    "anything",
    "everything",
    "nothing",
    "someone",
    "already",
    "still",
    "again",
    "please",
    "tell",
    "told",
    "say",
    "said",
    "saying",
    "ask",
    "asking",
    "asked",
    "remember",
    "remind",
    "before",
    "earlier",
    "last",
    "time",
    "week",
    "day",
    "today",
    "didnt",
    "dont",
    "wasnt",
    "werent",
    "im",
    "ive",
    "ill",
    "youre",
    "theyre",
    "would",
    "could",
    "should",
  ].map((w) => w.toLowerCase()),
);

export function looksLikeRecallQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (RECALL_REGEXES.some((re) => re.test(t))) return true;
  if (/\?$/.test(t) && t.length >= 12 && /\b(remember|recall|earlier|before|codename|upset|tentai)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function buildRecallContractMessage(input: {
  kind: "no_older_slice" | "no_tokens" | "no_matches" | "hits";
  body?: string;
}): string {
  if (input.kind === "no_older_slice") {
    return "Session recall was considered: the user asked about earlier in this chat, but every message in this session still fits the recent window—there is no older archive slice to search. Answer from the visible thread only; do not pretend you ran a lookup.";
  }
  if (input.kind === "no_tokens") {
    return "Session recall: the message looked like a recall question, but there were no usable keywords to search older messages. Say you can't pull that from stored history without a clearer topic—do not invent.";
  }
  if (input.kind === "no_matches") {
    return "Session recall: older messages in this session (outside the recent window) were searched in the database; **no matching lines** were found. Tell the user honestly you couldn't find that in what's stored—do not guess.";
  }
  return `Retrieved older turns from this session (outside the recent chat window). These lines come from a **database text search**, not from model weights or hidden memory:\n---\n${
    input.body ?? ""
  }\n---\nUse them only if they answer the user's question. If they don't, say so plainly. Do not invent beyond this evidence.`;
}

function extractRecallTokens(userMessage: string): string[] {
  const words = userMessage.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const lw = w.toLowerCase();
    if (lw.length < 2 || STOPWORDS.has(lw)) continue;
    if (!seen.has(lw)) {
      seen.add(lw);
      out.push(w);
    }
    if (out.length >= 12) break;
  }
  if (out.length > 0) return out;
  const fallback = userMessage.replace(/\s+/g, " ").trim().slice(0, 48);
  return fallback.length >= 2 ? [fallback] : [];
}

/**
 * System messages to insert after rolling recap and before recent history.
 * Empty when this turn is not a recall-style question.
 */
export async function buildRecallSystemMessages(
  sessionId: string,
  userMessage: string,
  excludeRecentCount: number,
): Promise<Array<{ role: "system"; content: string }>> {
  if (!looksLikeRecallQuestion(userMessage)) return [];

  const total = await countSessionMessages(sessionId);
  if (total <= excludeRecentCount) {
    return [
      {
        role: "system",
        content: buildRecallContractMessage({ kind: "no_older_slice" }),
      },
    ];
  }

  const excludeIds = await listRecentMessageIdsForSession(sessionId, excludeRecentCount);
  const tokens = extractRecallTokens(userMessage);
  if (tokens.length === 0) {
    return [
      {
        role: "system",
        content: buildRecallContractMessage({ kind: "no_tokens" }),
      },
    ];
  }

  const hits = await searchSessionMessageArchive(sessionId, excludeIds, tokens, 6);
  if (hits.length === 0) {
    return [
      {
        role: "system",
        content: buildRecallContractMessage({ kind: "no_matches" }),
      },
    ];
  }

  const body = hits
    .map((h) => `[${h.role === "user" ? "User" : "Vi"}]\n${h.content}`)
    .join("\n---\n");

  return [
    {
      role: "system",
      content: buildRecallContractMessage({ kind: "hits", body }),
    },
  ];
}
