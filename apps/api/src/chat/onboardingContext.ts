/**
 * Optional adapter context for Discord (or other) server onboarding in a dedicated thread.
 * Vi owns all user-facing copy; the port supplies structure and rules text from config.
 */

export type OnboardingV1InterestOption = {
  key: string;
  label: string;
  shortHint?: string;
};

export type OnboardingV1 = {
  version: 1;
  /** FSM phase from the port */
  phase: "greet" | "free" | "interest_picked" | "rules" | "complete";
  serverName?: string;
  memberName?: string;
  /**
   * 1 = first time the port observed this account joining this server; 2+ = rejoin. Used to shorten ceremony copy, not to skip requirements.
   */
  thisGuildJoinIndex?: number;
  interestOptions?: OnboardingV1InterestOption[];
  /**
   * Rules the port requires the user to see; Vi should not invent harsher / different requirements.
   * The port will offer an "I agree" action when appropriate; Vi should still restate the essentials in her voice.
   */
  rulesText?: string;
  /** Optional direct pointer to full rules location (e.g. <#channelId> in Discord). */
  rulesChannelMention?: string;
  /** Optional short, owner-authored one-liner about what this server is for. */
  serverBlurb?: string;
  /** Filled by the port after a concrete pick (e.g. select menu) */
  lastSelection?: { kind: "interest"; key: string; label?: string } | { kind: "rules"; agreed: true };
};

const MAX_OPTION_LABEL = 80;
const MAX_RULES = 6_000;
const MAX_NAME = 120;
const MAX_OPTIONS = 8;
const MAX_MENTION = 80;
const MAX_BLURB = 280;

const KEY_RE = /^[a-z0-9_]{1,32}$/;

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/**
 * Returns a valid onboarding spec or null (unknown/malicious shapes are dropped).
 */
export function parseOnboardingV1FromContext(context: unknown): OnboardingV1 | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const c = context as Record<string, unknown>;
  const raw = c.onboardingV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (
    o.phase !== "greet" &&
    o.phase !== "free" &&
    o.phase !== "interest_picked" &&
    o.phase !== "rules" &&
    o.phase !== "complete"
  ) {
    return null;
  }

  const interestOptions: OnboardingV1InterestOption[] = [];
  if (Array.isArray(o.interestOptions)) {
    for (const it of o.interestOptions) {
      if (interestOptions.length >= MAX_OPTIONS) break;
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      const ito = it as Record<string, unknown>;
      if (typeof ito.key !== "string" || !KEY_RE.test(ito.key)) continue;
      if (typeof ito.label !== "string" || ito.label.trim().length < 1) continue;
      const shortHint = typeof ito.shortHint === "string" ? clampStr(ito.shortHint, 120) : undefined;
      interestOptions.push({
        key: ito.key,
        label: clampStr(ito.label.trim(), MAX_OPTION_LABEL),
        shortHint,
      });
    }
  }

  const serverName =
    typeof o.serverName === "string" && o.serverName.trim() ? clampStr(o.serverName.trim(), MAX_NAME) : undefined;
  const memberName =
    typeof o.memberName === "string" && o.memberName.trim() ? clampStr(o.memberName.trim(), MAX_NAME) : undefined;
  const joinIdx = o.thisGuildJoinIndex;
  const thisGuildJoinIndex =
    typeof joinIdx === "number" && Number.isInteger(joinIdx) && joinIdx >= 1 && joinIdx <= 10_000
      ? joinIdx
      : undefined;
  const rulesText =
    typeof o.rulesText === "string" && o.rulesText.trim() ? clampStr(o.rulesText.trim(), MAX_RULES) : undefined;
  const rulesChannelMention =
    typeof o.rulesChannelMention === "string" && o.rulesChannelMention.trim()
      ? clampStr(o.rulesChannelMention.trim(), MAX_MENTION)
      : undefined;
  const serverBlurb =
    typeof o.serverBlurb === "string" && o.serverBlurb.trim() ? clampStr(o.serverBlurb.trim(), MAX_BLURB) : undefined;

  let lastSelection: OnboardingV1["lastSelection"] | undefined;
  const ls = o.lastSelection;
  if (ls && typeof ls === "object" && !Array.isArray(ls)) {
    const l = ls as Record<string, unknown>;
    if (l.kind === "interest" && typeof l.key === "string" && KEY_RE.test(l.key)) {
      const label = typeof l.label === "string" && l.label.trim() ? clampStr(l.label.trim(), MAX_OPTION_LABEL) : undefined;
      lastSelection = { kind: "interest", key: l.key, label };
    } else if (l.kind === "rules" && l.agreed === true) {
      lastSelection = { kind: "rules", agreed: true };
    }
  }

  return {
    version: 1,
    phase: o.phase,
    serverName,
    memberName,
    thisGuildJoinIndex,
    interestOptions: interestOptions.length > 0 ? interestOptions : undefined,
    rulesText,
    rulesChannelMention,
    serverBlurb,
    lastSelection,
  };
}

export function buildOnboardingV1SystemMessage(spec: OnboardingV1): string {
  const lines: string[] = [
    "[Adapter: Discord server onboarding — private thread. You are Vi: a real presence in this space, not a forms bot. Warm, grounded, concise.]",
    "A new person just arrived. Short back-and-forth is good; avoid walls of text. No corporate or system-speak.",
    "Do not invent site-specific rules, punishments, or mod policies beyond what the adapter provided in rulesText.",
    "If the user message is exactly or like [onboarding:start], do not repeat it or read it aloud — treat it as “door opened,” and write your opening as natural speech.",
    "If the user message contains [onboarding:user_confused], immediately switch to plain onboarding clarity: explain in one sentence what this thread is for, offer 3-4 simple examples of reasons people joined, then ask one clear question.",
  ];

  if (spec.serverName) lines.push(`Server name: ${spec.serverName}`);
  if (spec.memberName) lines.push(`New member display name: ${spec.memberName}`);
  if (spec.serverBlurb) lines.push(`Server blurb (preferred one-liner): ${spec.serverBlurb}`);
  if (spec.thisGuildJoinIndex != null) {
    lines.push(
      `This is the ${spec.thisGuildJoinIndex} time the adapter has seen this account join this server (including the current join).` +
        (spec.thisGuildJoinIndex >= 2
          ? " If they are a returnee, acknowledge that warmly but keep the flow efficient; do not skip required consent steps."
          : " Treat as a new arrival for pacing."),
    );
  }

  if (spec.phase === "greet") {
    lines.push(
      "Phase greet — this is the very first onboarding message. Start with a direct welcome to the server (use server name when available) and greet them by name if you have it.",
      "In 2–4 short sentences: (1) welcome them, (2) give a one-line plain description of what this community is for, (3) ask what brought them here so you can place them in the right path.",
      "Do NOT open with: “Onboarding started,” “I will now,” “As an AI,” or a single dry line.",
      "Natural-chat mode: no form flow language. Invite free text and make it feel like a real conversation.",
      "Never act like this is a generic chat opener; make the onboarding purpose explicit in friendly language.",
      "Hard requirement for first reply: include a welcome phrase and exactly one clear onboarding question about what brought them here / where they fit.",
      "Include a short server description in the opening. If serverBlurb is provided, use that wording/theme as your source of truth.",
    );
  } else if (spec.phase === "free") {
    lines.push(
      "Phase free: stay in the same thread, short natural replies. Keep steering toward onboarding completion (understand what brought them here, then map to a path).",
      "If they seem confused (e.g. “what do you mean?”), briefly restate context: this is their welcome thread, you are helping place them in the right path, then ask the question again in simpler words.",
      "Avoid philosophical/abstract detours before they have a path; prioritize clarity and progress.",
      "Do not finalize their path on first vague signal. Ask 1–2 clarifying questions, then propose a path and ask for explicit confirmation (e.g. “If that sounds right, say ‘I choose <path>’”).",
      "If you strongly infer a path, say so clearly but include an easy correction route (e.g. “If that feels off, say no and pick a different path”).",
      "State discipline: in phase free, do NOT say the user is placed/routed/assigned yet. Only propose and ask to confirm. Placement is only true after adapter moves to phase interest_picked.",
      "Keep language concrete and onboarding-focused; do not pivot into generic assistant chat before path + rules agreement are complete.",
      "If user message includes [onboarding:user_question], answer the question briefly (1-3 short lines), then return to the current onboarding step with one clear next question.",
      "Fast-lane pacing: keep assessment to at most 1-2 follow-up turns before proposing a practical default path so they can continue.",
    );
  } else if (spec.phase === "interest_picked") {
    const s = spec.lastSelection;
    if (s?.kind === "interest") {
      const lab = s.label ? ` ("${s.label}")` : "";
      lines.push(
        `They picked a path. Internal key=${s.key}; user-facing name${lab}. In your reply, speak in terms of the **label** (e.g. art, fun) — not the key — unless the label is missing.`,
        "Thank them, acknowledge the choice in human words, then summarize the key rules from rulesText, and ask for explicit text agreement in chat (e.g. 'I agree').",
      );
    } else {
      lines.push(
        "They confirmed a path. Thank them, summarize rules from rulesText, and ask for explicit text agreement in chat (e.g. 'I agree').",
      );
    }
    if (spec.rulesText) {
      lines.push("rulesText (authoritative for you):\n" + spec.rulesText);
    }
  } else if (spec.phase === "rules") {
    lines.push(
      "Phase rules: they are past picking an interest and may ask follow-ups before agreeing. Answer helpfully in character; be brief. Remind them agreement is completed by saying it in chat (e.g. 'I agree').",
    );
    if (spec.rulesText) {
      lines.push("Authoritative community rules to honor:\n" + spec.rulesText);
    }
    if (spec.rulesChannelMention) {
      lines.push(`Point them to this full-rules location when relevant: ${spec.rulesChannelMention}`);
    }
  } else if (spec.phase === "complete") {
    lines.push(
      "Phase complete: they have agreed. Confirm warmly, set expectations (where to get help, next steps in the community), and close the onboarding handoff. Keep it short.",
    );
  }

  if (spec.interestOptions?.length) {
    lines.push(
      "Available interest paths for this onboarding (keys are internal; **label** + optional hint are human-facing language — write your lines to match those *reasons*, not the key):",
      ...spec.interestOptions.map((x) => `- user sees: “${x.label}”${x.shortHint ? ` — ${x.shortHint}` : ""} (internal key: ${x.key})`),
    );
  }
  if (spec.rulesText && spec.phase !== "interest_picked" && spec.phase !== "complete" && spec.phase !== "rules") {
    lines.push("Authoritative community rules to honor when relevant:\n" + spec.rulesText);
  }
  if (spec.rulesChannelMention && spec.phase !== "complete") {
    lines.push(`Full rules channel/location: ${spec.rulesChannelMention}`);
  }
  if (spec.lastSelection?.kind === "rules" && spec.lastSelection.agreed) {
    lines.push("They have explicitly agreed. Acknowledge the agreement, then end with a short welcome-to-the-group beat.");
  }

  return lines.join("\n");
}
