/**
 * B9 (minimal) — turn-shape signals for routing / pacing only.
 * Ported in spirit from legacy conversationTurnSignals; no placeholder-name logic needed for this slice.
 */

export function isRelationalPresenceCue(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bsay something(?:\s+real)?\s+about\b/i.test(t)) return false;
  if (/\b(icmp|packet|latency|networking|ssh|tcp|udp)\b/i.test(t)) return false;

  if (/\btalk to me\b/i.test(t)) return true;
  if (/\bstill with me\b/i.test(t)) return true;
  if (/\bstay with me\b/i.test(t)) return true;
  if (/\byou still there\b/i.test(t)) return true;
  if (/\bsay something(?:\s+real)?\b/i.test(t)) return true;

  const core = t.replace(/^vi\b[\s,!.?:-]*/i, "").replace(/^(?:please|pls)[\s,]+/i, "").trim();
  if (/^ping\b(?:\s+(?:please|pls))?[\s,.!?…]*$/i.test(core)) return true;

  if (/(?:^|[\s,—-])(?:hi|hello|hey)\s*\?(?:\s*$|[\s.!…])/i.test(t)) return true;

  return false;
}

export function isSubstantiveConversationTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (/\b(are you there|you there|wake up)\b/.test(t)) return false;

  if (/\bhow\s+(?:are\s+you|is\s+it\s+going|you\s+been|have\s+you\s+been)\b/i.test(t)) return false;
  if (/\bhow\s+do\s+you\s+feel\b/i.test(t) && !/\bhow\s+do\s+you\s+feel\s+about\b/i.test(t)) return false;
  if (/\bhow\s+you\s+doing\b/i.test(t)) return false;
  if (/\bhow\s+are\s+things\b/i.test(t)) return false;

  if (/\?/.test(t)) {
    const alnumLen = (t.match(/[a-z0-9]/gi) ?? []).length;
    if (alnumLen >= 8 || /\b(what|who|how|why|when|where|which|whose|can|could|would|do|does|is|are)\b/i.test(t)) {
      return true;
    }
  }

  if (/\b(what|who|how|why|when|where|which|whose)\b/i.test(t)) return true;

  if (/\b(can you|could you|would you|tell me|explain|describe)\b/i.test(t)) return true;

  if (/\bare you\b/i.test(t)) return true;

  if (/\bdo you\b/i.test(t)) return true;

  if (/\b(is the|are the|does the|is it)\b/i.test(t)) return true;

  if (/\b\d\b\s*(times|x|×|\*|plus|\+|minus|−|multiplied|divided)\s*(by\s*)?\b\d\b/i.test(t)) return true;

  if (/\b(weather|temperature|forecast)\b/i.test(t)) return true;
  if (/\bwhether\b/i.test(t) && /\b(like|outside|today)\b/i.test(t)) return true;

  if (/\b(play|playing|music|jam|song|spotify|playlist)\b/i.test(t)) return true;

  if (/\broast\b/i.test(t)) return true;

  if (/\b(creator|made you|built you|your creator)\b/i.test(t)) return true;

  if (/\bwho is\b/i.test(t)) return true;

  if (/\b(if you were human|would you do)\b/i.test(t)) return true;

  if (/\b(don't|do not)\s+pretend\s+(?:that\s+)?(?:you(?:'re| are)|to be)\b/i.test(t)) return true;
  if (/\bstop\s+pretending\b/i.test(t)) return true;
  if (/\b(you're|you are)\s+not\s+(?:a\s+)?real\s+person\b/i.test(t)) return true;
  if (/\b(you're|you are)\s+just\s+(?:an?\s+)?(?:ai|bot|llm|model|program)\b/i.test(t)) return true;
  if (/\banswer\s+straight\b/i.test(t)) return true;
  if (/\bbe\s+real\b/i.test(t)) return true;
  if (/\bstop\s+acting\b/i.test(t)) return true;

  return false;
}
