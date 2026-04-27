import { enforceVoiceReply } from "../packages/core/src/humanity/voice/enforceVoice.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function evalDirectRelationalQuestionNoForcedFollowUp(): void {
  const out = enforceVoiceReply("Yeah, I like you.", {
    userMessage: "Do you like me?",
    humanity: { responseMode: "descriptive", posture: "warm", wantsIntent: "none" },
  });
  assert(!/what stood out most to you there\?/i.test(out), "direct relational asks should not auto-append follow-up");
}

function evalIdentityClarificationNoForcedFollowUp(): void {
  const out = enforceVoiceReply("Got it, Shykem. Wednesday and Nyx are your friends.", {
    userMessage: "My name is Shykem. Wednesday and Nyx are my friends.",
    humanity: { responseMode: "descriptive", posture: "warm", wantsIntent: "none" },
  });
  assert(!/what stood out most to you there\?/i.test(out), "identity clarification should not trigger generic follow-up");
}

function evalMechanicalWarmthSoftening(): void {
  const out = enforceVoiceReply("No subjective warmer shift on my side.", {
    userMessage: "Does anything feel different to you now?",
    humanity: { responseMode: "descriptive", posture: "warm", wantsIntent: "none" },
  });
  assert(/continuity staying cleaner and steadier/i.test(out), "overly mechanical warmth phrasing should be softened");
}

function main(): void {
  evalDirectRelationalQuestionNoForcedFollowUp();
  evalIdentityClarificationNoForcedFollowUp();
  evalMechanicalWarmthSoftening();
  console.log("- [PASS] conversational warmth regression invariants");
}

main();
