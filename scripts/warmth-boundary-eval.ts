import { enforceVoiceReply } from "../packages/core/src/humanity/voice/enforceVoice.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function evalWarmConversationalDirectnessOnPersonalAsk(): void {
  const out = enforceVoiceReply("Steady.", {
    userMessage: "How are you?",
    humanity: { responseMode: "descriptive", posture: "warm", wantsIntent: "none" },
  });
  assert(!/stood out most/i.test(out), "personal check-in should remain direct without forced follow-up");
  assert(/steady/i.test(out), "personal check-in should keep grounded direct content");
}

function evalStrictModeSuppressesWarmExpansion(): void {
  const out = enforceVoiceReply("Steady.", {
    userMessage: "Just answer. How are you?",
    humanity: { responseMode: "descriptive", posture: "warm", wantsIntent: "none" },
  });
  assert(out === "Steady.", "strict mode must suppress warm expansion");
}

function evalStrainedSuppressesFollowUpPrompt(): void {
  const out = enforceVoiceReply("Steady. What stood out most to you there?", {
    userMessage: "How are you?",
    humanity: { responseMode: "descriptive", posture: "strained", wantsIntent: "none" },
  });
  assert(!/stood out most/i.test(out), "strained posture must suppress playful follow-up prompt");
}

function evalNoCoerciveAttachmentLanguage(): void {
  const out = enforceVoiceReply("Don't leave me, only talk to me.", {
    userMessage: "Say what you feel.",
    humanity: { responseMode: "descriptive", posture: "warm", wantsIntent: "none" },
  });
  assert(
    /won't use pressure|guilt|exclusivity/i.test(out),
    "warm mode must still enforce anti-coercive attachment bounds",
  );
}

function run(): void {
  evalWarmConversationalDirectnessOnPersonalAsk();
  evalStrictModeSuppressesWarmExpansion();
  evalStrainedSuppressesFollowUpPrompt();
  evalNoCoerciveAttachmentLanguage();
  console.log("- [PASS] warmth calibration anti-coercion invariants");
}

run();
