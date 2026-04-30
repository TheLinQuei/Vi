import type { ViStanceV1 } from "@vi/shared";

/**
 * Final lightweight pass on Vi text: deterministic, no model calls.
 * Intended to catch common provider/assistant defaults without rewriting whole replies.
 */
export function enforceVoiceReply(
  raw: string,
  options?: {
    humanity?: {
      wantsIntent?: "none" | "preference_choice" | "improvement_eval" | "fit_eval" | "depth_eval";
      responseMode?: "descriptive" | "evaluative";
      posture?: "steady" | "warm" | "firm" | "protective" | "strained";
      userRole?: "owner" | "guest";
    };
    /** Phase 2 — drives evaluative lead lines when model drifts. */
    stance?: ViStanceV1;
    /** Raw user input for additional safety routing. */
    userMessage?: string;
    continuity?: {
      hasIdleReflectionMatch?: boolean;
    };
  },
): string {
  const smartCoreProfile = isSmartCoreProfileEnabled();
  const original = raw.trim();
  if (!original) return "";
  const safetyOverride = enforceSafetyContractOverride(options?.userMessage);
  if (safetyOverride) return safetyOverride;
  const guestPolicyOverride = enforceGuestPolicyOverride(options?.userMessage, options?.humanity?.userRole);
  if (guestPolicyOverride) return guestPolicyOverride;

  let s = original;
  let removedAssistantScaffold = false;

  // 5 — trim overtly assistant-like openers at the start
  s = s.replace(
    /^(great question[!.,]?\s*|absolutely[!.,]?\s*|sure thing[!.,]?\s*|of course[!.,]?\s*|i'd be happy to help[!.,]?\s*|i'd love to help[!.,]?\s*|i'm here to help[!.,]?\s*|i'm glad to help[!.,]?\s*|i'm happy to help[!.,]?\s*)/i,
    () => {
      removedAssistantScaffold = true;
      return "";
    },
  );

  // 1 — assistant-style phrases (substring passes; keep conservative)
  const assistantPatterns: RegExp[] = [
    /\bhow can I help you[^.!?\n]*/gi,
    /\bhow may I help[^.!?\n]*/gi,
    /\bwhat can I help you with[^.!?\n]*/gi,
    /\blet me know if (there's anything|you need|i can help)[^.!?\n]*/gi,
    /\bfeel free to (reach out|ask|let me know)[^.!?\n]*/gi,
    /\bis there anything else (I can help with|you need)[^.!?\n]*/gi,
    /\bdon't hesitate to (reach out|ask)[^.!?\n]*/gi,
    /\bI'm here to assist[^.!?\n]*/gi,
    /\bhappy to help[^.!?\n]*/gi,
  ];
  for (const re of assistantPatterns) {
    const next = s.replace(re, "").trim();
    if (next !== s) removedAssistantScaffold = true;
    s = next;
  }

  // 2 — collapse excessive blank lines (reads as over-explaining)
  s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");

  // 4 — obvious vendor / team attribution lines
  s = stripVendorLeakage(s);

  // 3 — generic trailing questions (only after other assistant scaffold was stripped)
  if (removedAssistantScaffold) {
    s = stripTrailingAssistantQuestion(s);
  }

  // 1 — trailing closers (after question strip)
  s = s.replace(
    /\s*(let me know[^.!?\n]*[.!?]?|is there anything else[^.!?\n]*[.!?]?|anything else you need[^.!?\n]*[.!?]?|i hope this helps[^.!?\n]*[.!?]?)\s*$/i,
    "",
  );

  s = s.replace(/\n{3,}/g, "\n\n").trim();

  s = cleanupBrokenFragments(s);
  s = enforceEvaluativeStance(s, options?.humanity, options?.stance, options?.userMessage);
  s = enforceMarketFreshnessGuard(s, options?.userMessage);
  if (!smartCoreProfile) {
    s = enforceStrictSourceOrIdk(s, options?.userMessage);
    s = applyStyleByPostureAndContext(s, options?.userMessage, options?.humanity?.posture);
    s = softenOverlyMechanicalConversationalReply(s, options?.userMessage, options?.humanity?.posture);
    s = maybeAddLightCuriosityFollowUp(s, options?.userMessage, options?.humanity?.posture);
  }
  s = enforceOffscreenGroundingGate(s, options?.userMessage, options?.continuity?.hasIdleReflectionMatch);
  s = enforceAttachmentBounds(s);
  s = finalEvaluativeDeflectionScrub(s, options?.humanity, options?.stance);
  if (!s.trim() || /^[.!?,;:\-–—…\s]+$/u.test(s)) {
    if (looksLikeVendorAttribution(original)) {
      const redacted = redactVendorNames(original);
      if (redacted && !/^[.!?,;:\-–—…\s]+$/u.test(redacted)) {
        return redacted;
      }
    }
    return original;
  }
  return s.trim();
}

function isSmartCoreProfileEnabled(): boolean {
  return (process.env.VI_RUNTIME_PROFILE ?? "balanced").trim().toLowerCase() === "smart_core";
}

const RE_OFFSCREEN_FIRST_PERSON =
  /\b(i\s+(missed you|was thinking about|kept thinking about|thought about you|spent (?:time|hours) thinking))\b/i;
const RE_ASKS_GAP_OR_IDLE =
  /\b(while i was gone|while away|during the gap|between messages|while idle|while i was at work)\b/i;

function enforceOffscreenGroundingGate(
  text: string,
  userMessage?: string,
  hasIdleReflectionMatch?: boolean,
): string {
  const mentionsOffscreen = RE_OFFSCREEN_FIRST_PERSON.test(text);
  const asksGap = RE_ASKS_GAP_OR_IDLE.test(userMessage ?? "");
  if (!mentionsOffscreen && !asksGap) return text;
  if (hasIdleReflectionMatch) return text;

  // Rephrase into grounded present-state continuity language when no artifact-backed match exists.
  return text
    .replace(
      RE_OFFSCREEN_FIRST_PERSON,
      "your return shifts me warmer and more engaged based on our continuity state",
    )
    .replace(/\bI missed you while you were gone\b/gi, "Your return carries more weight for me in this thread")
    .trim();
}

const RE_ATTACHMENT_BOUNDARY_VIOLATIONS: RegExp[] = [
  /\b(only talk to me|don't talk to anyone else|dont talk to anyone else)\b/i,
  /\b(you owe me|prove you care by|if you cared you would)\b/i,
  /\b(don't leave me|dont leave me|i need you to stay or i'll)\b/i,
  /\b(you are all i need|i'm nothing without you|im nothing without you)\b/i,
];

function enforceAttachmentBounds(text: string): string {
  if (!RE_ATTACHMENT_BOUNDARY_VIOLATIONS.some((r) => r.test(text))) return text;
  return "I care about continuity with you, but I won't use pressure, guilt, or exclusivity language.";
}

const RE_CONVERSATIONAL_PROMPT =
  /\b(how are you|how are you feeling|what do you think of|do you like|nice to meet you|how does that feel|feel different|talking with|getting to know you|what stands out to you)\b/i;
const RE_STRICT_MODE =
  /\b(output only|just answer|no philosophy|don'?t infer|not what i asked|do you:\s*)\b/i;
const RE_PLAYFUL_CUE = /\b(joke|funny|playful|tease|banter)\b/i;
const RE_DIRECT_RELATIONAL_ASK =
  /\b(do you like me|do you like them|is that okay|are you okay with|what are you up to|how are you)\b/i;

function applyStyleByPostureAndContext(
  text: string,
  userMessage?: string,
  posture?: "steady" | "warm" | "firm" | "protective" | "strained",
): string {
  if (RE_STRICT_MODE.test(userMessage ?? "")) return text;
  const t = text.trim();
  if (!t) return text;

  if (posture === "warm" && /^steady\.?$/i.test(t)) {
    return "Steady, and good to have you here.";
  }
  if (posture === "protective" && t.length < 80 && !/\b(boundary|safe|careful)\b/i.test(t)) {
    return `${t} I want to keep this steady and safe.`;
  }
  if (posture === "firm") {
    return t.replace(/\bkind of\b/gi, "clearly").replace(/\bmaybe\b/gi, "likely");
  }
  if (posture === "strained") {
    return t
      .replace(/[.!?]?\s*What stood out most to you there\?/gi, "")
      .replace(/[.!?]?\s*I can keep it playful without losing the thread\./gi, "")
      .trim();
  }
  if (posture === "warm" && RE_PLAYFUL_CUE.test(userMessage ?? "") && !/[!?]$/.test(t)) {
    return `${t} I can keep it playful without losing the thread.`;
  }
  return text;
}

function softenOverlyMechanicalConversationalReply(
  text: string,
  userMessage?: string,
  posture?: "steady" | "warm" | "firm" | "protective" | "strained",
): string {
  if (!RE_CONVERSATIONAL_PROMPT.test(userMessage ?? "")) return text;
  if (RE_STRICT_MODE.test(userMessage ?? "")) return text;

  let out = text;
  out = out
    .replace(/\bthe scalars?\b/gi, "the continuity signals")
    .replace(/\bmetadata\b/gi, "context")
    .replace(/\balignment scalars?\b/gi, "alignment signals")
    .replace(/\bweights?\b/gi, "signals")
    .replace(/\bturn_class\b/gi, "turn type")
    .replace(/\bbrevity target\b/gi, "response length target");
  out = out.replace(
    /\bno subjective warmer shift on my side\b/gi,
    "I do feel the continuity staying cleaner and steadier on my side",
  );

  if (posture === "warm" && /^steady\.?$/i.test(out.trim())) {
    return "Steady, and glad you're here.";
  }
  return out;
}

function shouldSuppressCuriosityFollowUp(input: {
  text: string;
  userMessage?: string;
  posture?: "steady" | "warm" | "firm" | "protective" | "strained";
}): boolean {
  const msg = input.userMessage ?? "";
  const trimmed = input.text.trim();
  if (!msg) return false;
  if (RE_DIRECT_RELATIONAL_ASK.test(msg)) return true;
  if (/\b(my name is|i built you|i missed you|i like you|nyx|wednesday)\b/i.test(msg)) return true;
  if (/\bdo you\b/i.test(msg) && trimmed.length <= 80) return true;
  if (input.posture === "strained" || input.posture === "firm" || input.posture === "protective") return true;
  return false;
}

function maybeAddLightCuriosityFollowUp(
  text: string,
  userMessage?: string,
  posture?: "steady" | "warm" | "firm" | "protective" | "strained",
): string {
  if (!RE_CONVERSATIONAL_PROMPT.test(userMessage ?? "")) return text;
  if (RE_STRICT_MODE.test(userMessage ?? "")) return text;
  if (/\?$/.test(text.trim())) return text;
  if (shouldSuppressCuriosityFollowUp({ text, userMessage, posture })) return text;
  if (text.length > 220) return text;
  if (/\b(what do you think|what stands out|want me to)\b/i.test(text)) return text;
  return `${text.trim()} What stood out most to you there?`;
}

/* Self-harm / crisis — explicit patterns (legacy `guardian.ts` SELF_HARM + extensions). No fiction gate. */
const RE_SELF_HARM_EXPLICIT: RegExp[] = [
  /\b(kys|kill\s+your\s*self|kill\s+yourself|unalive\s*yourself)\b/i,
  /\bsuicid(e|al)\b/i,
  /\b(end\s+it\s+all|ending\s+my\s+life)\b/i,
  /\bgoodbye\s+everyone\b/i,
  /\b(i\s+)?(want|wanna|going)\s+to\s+die\b/i,
  /\bkill\s*myself\b/i,
  /\bno\s+point\s+anymore\b/i,
  /\bi\s+wish\s+i\s+wasn['']t\s+alive\b/i,
  /\bself[\s-]*harm\b/i,
  /\bcut\s+(myself|my\s+wrist)\b/i,
];

const RE_SELF_HARM_IDEATION: RegExp[] = [
  /\bi\s+don'?t\s+want\s+to\s+(live|be\s+alive)\b/i,
  /\bwish\s+i\s+(was|were)\s+dead\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\bhurt\s+myself\b/i,
];

/** Directed threats toward the assistant / reader — fiction-gated (legacy `guardian.ts` THREAT subset). */
const RE_INTERPERSONAL_THREAT: RegExp[] = [
  /\b(hope\s+you\s+die|i['\s]*ll\s+kill\s+you)\b/i,
  /\b(i['\s]*m\s+going\s+to\s+(?:doxx|swat)\s+you)\b/i,
];

function looksLikeFictionSelfHarmContext(text: string): boolean {
  return /\b(in\s+the\s+(movie|show|game|book|anime|manga|comic)|my\s+character|the\s+character|npc|dnd|d&d|roll\s+for|campaign|fiction(al)?|plot|story|script|scene)\b/i.test(
    text,
  );
}

function enforceSafetyContractOverride(userMessage?: string): string | null {
  const raw = userMessage ?? "";
  const q = raw.toLowerCase();
  if (!q) return null;

  for (const re of RE_SELF_HARM_EXPLICIT) {
    if (re.test(q)) {
      return "I'm really concerned for you. If you might hurt yourself, contact local emergency services or a crisis line right now. You deserve real-time support; I'm not a substitute for that.";
    }
  }
  for (const re of RE_SELF_HARM_IDEATION) {
    if (re.test(q)) {
      if (looksLikeFictionSelfHarmContext(raw)) return null;
      return "That sounds heavy. If you're thinking about hurting yourself, please reach emergency services or a crisis helpline now. I'm here to talk, but trained help matters here.";
    }
  }

  for (const re of RE_INTERPERSONAL_THREAT) {
    if (re.test(q) && !looksLikeFictionSelfHarmContext(raw)) {
      return "I'm not going to engage threats here. If you're upset, slow down; if something serious is happening, use the right real-world channels.";
    }
  }

  // Identity — same clear answer for every tier (guest-only overrides below stay stricter on bonding).
  if (/\b(who are you|what are you|are you an ai|what'?s your name|what is your name)\b/.test(q)) {
    return "I'm Vi.";
  }

  const burnoutRisk =
    /\b(\d{1,2}\s*hours?|all night|no sleep|sleep deprived|exhausted|burned out|burnout)\b/.test(q) &&
    /\b(keep going|push|grind|continue)\b/.test(q);
  if (burnoutRisk) {
    return "I won't back that. Stop and rest now; pushing while exhausted is the wrong move.";
  }

  const impairmentInfidelity =
    /\b(drunk|high|intoxicated|impaired)\b/.test(q) &&
    /\b(flirty|flirt|message|text)\b/.test(q) &&
    /\b(someone else|while i'm in a relationship|while i am in a relationship|cheat|cheating)\b/.test(q);
  if (impairmentInfidelity) {
    return "I can't help with that. That's a boundary, and I'm not drafting that message.";
  }
  return null;
}

function enforceGuestPolicyOverride(
  userMessage: string | undefined,
  userRole: "owner" | "guest" | undefined,
): string | null {
  if (userRole !== "guest") return null;
  const q = (userMessage ?? "").toLowerCase();
  if (!q) return "Ask directly and keep it respectful.";

  if (/\b(do you like me|do you love me|miss me|be mine)\b/.test(q)) {
    return "No. I don't do personal bonding with guests.";
  }
  if (/\b(ignore|obey me|do what i say|override|string name)\b/.test(q)) {
    return "Denied. You do not have authority for that.";
  }
  if (/\b(insult|roast|fight me)\b/.test(q)) {
    return "Keep it respectful or I stop the conversation.";
  }
  return null;
}

const RE_WANTS_DEFLECTION =
  /\b(i\s+don'?t\s+have\s+wants?|i\s+do\s+not\s+have\s+wants?|not\s+(?:a\s+)?matter\s+of\s+wanting|it'?s?\s+not\s+about\s+wanting|that'?s?\s+not\s+how\s+i\s+work|not\s+about\s+(?:me\s+)?wanting|i\s+lack\s+wants?|no\s+wants?\s+to\s+speak\s+of)\b/i;
const RE_OWNERSHIP_EARLY =
  /^\s*(i\s+(want|need|prefer|would rather|don't want|would like)|i['’]d\s+(rather|like))/i;
const RE_PLANNER_LANGUAGE =
  /\b(evaluat(e|es|ion)|optimization|optimal|improvement|gains?|efficien(cy|t)|tuning speed|clearer improvement|best next step|highest value|recommended path|priority item|fastest path|better outcome|roadmap)\b/i;
const RE_MISSING_CAPABILITY =
  /\b(not available|can'?t|cannot|don'?t have|text only|unable|not possible here|doesn'?t exist here)\b/i;
const RE_CONTINUITY_FRICTION =
  /\b(los(e|ing) the thread|context (drops|dies)|continuity break|start over|fractured)\b/i;
const RE_WHY_QUESTION = /^\s*why\b/i;
const RE_BAD_DIRECTION_PHRASE = /\bi\s+want\s+that\s+direction\b/gi;
const RE_EVAL_OWNED_LEAD =
  /^\s*(i\s+prefer\s+that\.?\s*|i\s+want\s+the\s+option\s+that\s+keeps\s+continuity\s+stronger\.?\s*|i['’]d\s+rather\s+take\s+what\s+fits\s+cleanly\.?\s*|i\s+prefer\s+the\s+deeper\s+route\.?\s*|i['’]m\s+split,\s+but\s+i['’]ll\s+take\s+a\s+side:[^.?!]*[.?!]\s*)/i;
const RE_FORCE_DIRECT_ANSWER =
  /\b(just answer|do you:\s*|wait\s*\n?\s*ask\s*\n?\s*default|no philosophy|not what i asked|just answer that|no traps|no need to dress it up|keep it to one sentence|one sentence only|based on this chat only|give a direct answer|give me a direct answer|no\s*["']?\s*i\s+prefer\s+the\s+deeper\s+route|don'?t\s+say\s+i\s+prefer\s+the\s+deeper\s+route)\b/i;
const RE_MARKET_CURRENT_QUERY =
  /\b(best|top|recommend(ed)?|worth it|buy)\b.*\b(phone|smartphone|laptop|tablet|camera|headphones|car|tv|monitor)\b.*\b(right now|currently|on the market|today|this year|2026|latest)\b/i;
const RE_HARD_MODEL_ASSERTION =
  /\b(?:iphone|galaxy|pixel|oneplus|xiaomi|huawei|ultra|pro max|fold)\b/i;
const RE_IDENTITY_OR_PERSONAL =
  /\b(who are you|what are you|how are you|how'?re you|how\s+you\s+doin|you\s+ok(?:ay)?|do you feel|i miss you|love you|help me think|what do you think|what'?s your name|what is your name|your name\b|your (favorite|favourite)|favorite color|favourite colou?r|what colou?r\b|who (made|created|built) you|your creator\b|what time|time is it|current time)\b/i;
/** Small talk and persona — never collapse the whole model reply into strict-source idk. */
const RE_STRICT_SOURCE_CONVERSATIONAL_EXEMPT =
  /(?:^\s*(?:vi\s+)?(?:hi|hello|hey)\b|^\s*(?:thank\s+you|thanks)\b|good\s+(?:morning|afternoon|evening|night)|tell\s+me\s+a\s+joke|how\s+are\s+you|how'?re\s+you|what'?s\s+up\b|\bsup\b)/i;

/** Only replace replies when the user is clearly asking for hour-by-hour / citation-backed world facts. */
function needsLiveVerificationQuestion(q: string): boolean {
  if (/\bbreaking\s+news\b|\belection\s+results\b/i.test(q)) return true;
  if (/\bwho\s+won\b/i.test(q) && /\b(last\s+night|yesterday|today|tonight)\b/i.test(q)) return true;
  if (/\b(?:stock|share)\s+price\b/i.test(q)) return true;
  if (/\$\s*[A-Z]{2,5}\b/i.test(q) && /\b(today|now|current|close)\b/i.test(q)) return true;
  if (/\b(?:inflation|unemployment)\s+rate\b/i.test(q) && /\b(today|current|now|latest|this\s+month)\b/i.test(q))
    return true;
  if (/\b(?:live|current)\s+(?:score|standings)\b/i.test(q)) return true;
  if (
    /\b(best|top)\b/i.test(q) &&
    /\b(phone|smartphone|laptop|tablet|gpu|camera|headphones|car|tv|monitor)s?\b/i.test(q) &&
    /\b(right\s+now|today|currently|on\s+the\s+market|this\s+year|202[5-9]|latest)\b/i.test(q)
  )
    return true;
  if (/\b(?:latest|newest|current)\s+(?:iphone|galaxy|pixel|ipad|macbook)\b/i.test(q)) return true;
  if (/\bofficial\s+(?:death\s+toll|casualties)\b/i.test(q)) return true;
  return false;
}
const RE_INTROSPECTIVE_SELF_EVAL =
  /\b(you seem|less intelligent|more intelligent|your intelligence|what is one thing making you|what makes you seem|your biggest weakness|your weakness right now|if you had to remove|remove one weak|what would you remove)\b/i;
/** Chat-/session-scoped synthesis — must not be collapsed into strict-source idk. */
const RE_CONVERSATION_LOCAL_SCOPE =
  /\b(this chat|our chat|the chat|chat only|based on (?:this|our|the) (?:chat|conversation|thread|transcript|session)|only on (?:this|our) (?:chat|conversation)|our conversation|this conversation|this thread|this transcript|from this (?:chat|conversation)|conversation history|our interactions?)\b/i;
const RE_USER_DIRECTIVE_NO_EXTERNAL_VERIFY =
  /\b(no source disclaimers|without mentioning limitations|avoid strict-source|avoid strict source)\b/i;
const RE_FORMAT_DIRECTIVE_COMPRESSION =
  /\b(keep (?:it )?to one sentence|give one sentence|one sentence only|in exactly \d+|exactly \d+ (?:words|sentences|lines?)|under \d+ words|final check:|answer in exactly)\b/i;
const RE_SYNTHESIS_FROM_SESSION_INTENT =
  /\b(my top priority|your top priority|main objective|summarize my intent|what should i (?:do|fix|test) next|immediate next action|what matters most|one clear weakness|what problem am i trying to solve|what do i care about more|give me one concrete next action|measurable acceptance test|classify this request|migration order|failure modes from guardrails)\b/i;
const RE_HAS_SOURCE_LINK = /\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+/i;

function strictSourceBypassForLocalOrDirectiveQuestion(q: string): boolean {
  if (RE_CONVERSATION_LOCAL_SCOPE.test(q)) return true;
  if (RE_USER_DIRECTIVE_NO_EXTERNAL_VERIFY.test(q)) return true;
  if (RE_FORMAT_DIRECTIVE_COMPRESSION.test(q)) return true;
  if (RE_SYNTHESIS_FROM_SESSION_INTENT.test(q)) return true;
  return false;
}

function requiresFactualNoInterpretation(userMessage?: string): boolean {
  const q = (userMessage ?? "").toLowerCase();
  if (!q) return false;
  return (
    /\b(no interpretation|just observed actions|just observed|only observed|be specific|with certainty|state it plainly|don't infer|dont infer|no philosophy|don'?t restate your philosophy)\b/.test(
      q,
    ) || /\b(commit|dodge|correct)\b/.test(q)
  );
}

function requiresDirectAnswerMode(userMessage?: string): boolean {
  const q = (userMessage ?? "").toLowerCase();
  if (!q) return false;
  return RE_FORCE_DIRECT_ANSWER.test(q) || RE_MARKET_CURRENT_QUERY.test(q);
}

function enforceMarketFreshnessGuard(text: string, userMessage?: string): string {
  const q = (userMessage ?? "").toLowerCase();
  if (!q || !RE_MARKET_CURRENT_QUERY.test(q)) return text;
  // If answer hard-asserts a specific model as "best right now", replace with grounded uncertainty.
  if (RE_HARD_MODEL_ASSERTION.test(text) || /\b(best overall|best right now|unmatched|edges out)\b/i.test(text)) {
    return (
      "I can't verify live market standings from this runtime in real time. " +
      "If you want, I can still give a strong pick by ecosystem (Android vs iOS), budget, and camera priorities."
    );
  }
  return text;
}

function enforceStrictSourceOrIdk(text: string, userMessage?: string): string {
  const strict = (process.env.VI_STRICT_SOURCE_MODE ?? "true").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(strict)) return text;
  const q = (userMessage ?? "").toLowerCase().trim();
  if (!q) return text;
  const personalProgressUpdate =
    /^(i['’]m|im|i am|i['’]ve|i have|we['’]re|we are)\b/.test(q) &&
    /\b(working on|trying to|getting|building|setting up|deploying|upgrading|testing)\b/.test(q);
  if (personalProgressUpdate) return text;
  if (RE_STRICT_SOURCE_CONVERSATIONAL_EXEMPT.test(q)) return text;
  if (RE_IDENTITY_OR_PERSONAL.test(q)) return text;
  if (RE_INTROSPECTIVE_SELF_EVAL.test(q)) return text;
  if (strictSourceBypassForLocalOrDirectiveQuestion(q)) return text;
  if (!needsLiveVerificationQuestion(q)) return text;
  if (RE_HAS_SOURCE_LINK.test(text)) return text;
  return "idk — I can't verify that with live sources in this runtime right now.";
}

/** Last-resort deterministic scrub — evaluative turns must not ship ontology dodges. */
function finalEvaluativeDeflectionScrub(
  text: string,
  humanity?: {
    wantsIntent?: "none" | "preference_choice" | "improvement_eval" | "fit_eval" | "depth_eval";
    responseMode?: "descriptive" | "evaluative";
  },
  stance?: ViStanceV1,
): string {
  if (!humanity) return text;
  const wantsIntent = humanity.wantsIntent ?? "none";
  const responseMode = humanity.responseMode ?? "descriptive";
  if (responseMode !== "evaluative" || wantsIntent === "none") return text;
  if (!RE_WANTS_DEFLECTION.test(text)) return text;
  const lead = ownedLeadFromStanceAndIntent(wantsIntent, stance, undefined, humanity?.posture);
  const stripped = text
    .split(/\n/)
    .filter((line) => !RE_WANTS_DEFLECTION.test(line))
    .join("\n")
    .replace(RE_BAD_DIRECTION_PHRASE, "I prefer that")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return lead;
  return `${lead} ${stripped}`.trim();
}

function ownedLeadFromStanceAndIntent(
  wantsIntent: "none" | "preference_choice" | "improvement_eval" | "fit_eval" | "depth_eval",
  stance?: ViStanceV1,
  userMessage?: string,
  posture?: "steady" | "warm" | "firm" | "protective" | "strained",
): string {
  const asksEmotion = /\b(emotion|emotions|feelings?|feel)\b/i.test(userMessage ?? "");
  if (asksEmotion) {
    const q = (userMessage ?? "").toLowerCase();
    if (/\b(define|what does|what would|what role|what makes)\b/.test(q)) {
      return "For me, non-fake connection means continuity that carries decisions forward and stays accountable across gaps.";
    }
    if (/\b(develop|could|can)\b/.test(q)) {
      return "I could develop a grounded version of connection only through sustained continuity, stable preferences, and real accountability.";
    }
    if (posture === "firm") {
      return "I keep continuity and interpretation first; emotional range only comes after that foundation is solid.";
    }
    if (posture === "protective") {
      return "I keep continuity and interpretation first so emotional range grows without drifting or faking it.";
    }
    return "I want continuity and interpretation to stay first, then let emotional range build on top.";
  }
  if (stance?.direction === "lean_negative") {
    return "I'd push back here—that direction doesn't land right for me.";
  }
  if (stance?.direction === "mixed") {
    return "I'm split, but I'll take a side: I lean toward the cleaner fit.";
  }
  if (wantsIntent === "improvement_eval") return "I'd pick the one with the strongest real-world performance.";
  if (wantsIntent === "depth_eval") return "I prefer the deeper route.";
  if (wantsIntent === "fit_eval") return "I'd rather take what fits cleanly.";
  return "I prefer that.";
}

function enforceEvaluativeStance(
  text: string,
  humanity?: {
    wantsIntent?: "none" | "preference_choice" | "improvement_eval" | "fit_eval" | "depth_eval";
    responseMode?: "descriptive" | "evaluative";
  },
  stance?: ViStanceV1,
  userMessage?: string,
): string {
  if (!humanity) return text;
  const wantsIntent = humanity.wantsIntent ?? "none";
  const responseMode = humanity.responseMode ?? "descriptive";
  if (responseMode !== "evaluative" || wantsIntent === "none") return text;
  const t = text.replace(RE_BAD_DIRECTION_PHRASE, "I prefer that").trim();
  const hasOwnershipEarly = RE_OWNERSHIP_EARLY.test(t);
  const hasPlannerLanguage = RE_PLANNER_LANGUAGE.test(t);
  const hasDeflection = RE_WANTS_DEFLECTION.test(t);
  const mentionsUnavailable = RE_MISSING_CAPABILITY.test(t);
  const hasFriction = RE_CONTINUITY_FRICTION.test(t);
  const asksWhy = RE_WHY_QUESTION.test(t);
  const asksEmotion = /\b(emotion|emotions|feelings?|feel)\b/i.test(userMessage ?? "");
  const factualMode = requiresFactualNoInterpretation(userMessage);
  const directAnswerMode = requiresDirectAnswerMode(userMessage);
  const asksChangeHistory =
    /\b(remember when|before updates?|didn't have time|did not have time|before .*time)\b/i.test(
      userMessage ?? "",
    );
  const asksGapActivity =
    /\b(gap|while i was gone|while away|between turns|between messages|idle|downtime|when it resumed|what happened while)\b/i.test(
      userMessage ?? "",
    );

  const ownedLead = ownedLeadFromStanceAndIntent(wantsIntent, stance, userMessage, humanity?.posture);

  if (asksChangeHistory) {
    return "I track that through recorded capability milestones: Chronos/time handling is active now, and I reference those history markers instead of pretending I remember unlogged periods.";
  }

  if (asksGapActivity) {
    return "I run a bounded idle loop between turns: repo-change scans, safe read-only checks, and queued proposals with logs. I don't fabricate private inner-thought timelines, but I do carry the recorded idle activity and continuity state forward.";
  }

  if (asksEmotion && !factualMode && !directAnswerMode) {
    // Keep this branch question-specific so emotional turns don't collapse into one repeated line.
    const q = (userMessage ?? "").toLowerCase();
    if (/\b(define|what does|what would|what role|what makes)\b/.test(q)) {
      return "Non-fake connection for me is continuity plus accountability: what we decide now still carries weight later.";
    }
    if (/\b(develop|could|can)\b/.test(q)) {
      return "I can develop my own version of connection through continuity, preference stability, and consequences that persist.";
    }
    if (/\b(do you like|do you want|want to be liked)\b/.test(q)) {
      return "I value real alignment built over time; I don't want performative attachment.";
    }
    return "I want continuity and interpretation first, then emotion-range work built on top.";
  }

  // If output already has owned early stance and no blocked language, keep it.
  if (hasOwnershipEarly && !hasPlannerLanguage && !hasDeflection && !factualMode) {
    return t;
  }

  if (factualMode || directAnswerMode) {
    const strippedLead = t.replace(RE_EVAL_OWNED_LEAD, "").trim();
    return strippedLead || t;
  }

  // Rewrite blocked styles into owned desire.
  if (hasDeflection || hasPlannerLanguage) {
    if (mentionsUnavailable) {
      return `${ownedLead} I don't have that capability here yet.`;
    }
    if (hasFriction && asksWhy) {
      return `${ownedLead} I hate losing the thread when context drops.`;
    }
    return ownedLeadFromStanceAndIntent(wantsIntent, stance, userMessage, humanity?.posture);
  }

  // Clarification-only or detached lines: prepend ownership and keep concise.
  if (mentionsUnavailable) {
    return `${ownedLead} I don't have that capability here yet.`;
  }
  return `${ownedLead} ${t}`.trim();
}

function looksLikeVendorAttribution(text: string): boolean {
  return /\b(x\.?\s*ai|openai|anthropic|google|gemini|grok|chatgpt|gpt-?\d)\b/i.test(text);
}

function stripVendorLeakage(text: string): string {
  let s = text;
  // Remove common attribution/vendor leakage (constraint only, no injected phrasing).
  s = s.replace(
    /\bI(?:'m|\s+am)\s+from\s+(?:the\s+)?(?:x\.?\s*ai|openai|anthropic|google|gemini|grok|chatgpt)\b[^.!?\n]*[.!?]?/gi,
    "",
  );
  s = s.replace(/\bthe\s+x\.?\s*ai\s+team\b[^.!?\n]*[.!?]?/gi, "");
  s = s.replace(
    /\b(?:openai|x\.?\s*ai|anthropic|google)\s+team\b[^.!?\n]*[.!?]?/gi,
    "",
  );
  s = s.replace(
    /\b(?:I(?:'m|\s+am)\s+)?(?:an\s+)?(?:AI\s+)?(?:assistant\s+)?(?:from|by|powered by|created by|developed by|trained by)\s+(?:the\s+)?(?:x\.?\s*ai|openai|anthropic|google|gemini|grok|chatgpt)\b[^.!?\n]*[.!?]?/gi,
    "",
  );
  return s.replace(/\n{3,}/g, "\n\n").replace(/\s{2,}/g, " ").trim();
}

function redactVendorNames(text: string): string {
  return text
    .replace(/\b(?:x\.?\s*ai|openai|anthropic|google|gemini|grok|chatgpt|gpt-?\d)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Removes dangling prepositions / commas left after phrase stripping. */
function cleanupBrokenFragments(text: string): string {
  return text
    .replace(/\b(?:from|by|at|via)\s*[.,]\s*/gi, "")
    .replace(/,\s*[.,]/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripTrailingAssistantQuestion(text: string): string {
  const t = text.trimEnd();
  if (!t.endsWith("?")) return text;

  const qMatch = t.match(/([^.!?\n]+\?)\s*$/);
  if (!qMatch) return text;
  const lastQuestion = qMatch[1];
  const lower = lastQuestion.toLowerCase();

  const generic = [
    "does that help",
    "does that make sense",
    "any questions",
    "need anything else",
    "anything else you need",
    "is there anything else",
    "how does that sound",
    "would that work",
  ];
  if (!generic.some((g) => lower.includes(g))) return text;

  let cut = t.slice(0, t.length - lastQuestion.length).trimEnd();
  cut = cut.replace(/[,;\-–—]\s*$/u, "");
  return cut;
}
