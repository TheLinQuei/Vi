import { inferAddressedToVi } from "../apps/api/src/chat/addresseeRouting.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const groupCtx = { channelType: "group" as const, participants: ["alice", "nyx", "vi"] };

  const a1 = inferAddressedToVi({
    message: "Hey Nyx, can you check this?",
    context: groupCtx,
    viName: "vi",
  });
  assert(a1 === false, "should not route to Vi when another participant is explicitly addressed");

  const a2 = inferAddressedToVi({
    message: "Vi, what do you think?",
    context: groupCtx,
    viName: "vi",
  });
  assert(a2 === true, "should route to Vi when Vi is explicitly addressed");

  const a3 = inferAddressedToVi({
    message: "Can you summarize this for me?",
    context: groupCtx,
    viName: "vi",
  });
  assert(a3 === true, "should route to Vi on ambiguous second-person question in mixed context");

  const a4 = inferAddressedToVi({
    message: "whatever",
    context: { channelType: "group", participants: ["alice", "nyx", "vi"], addresseeHint: "nyx" },
    viName: "vi",
  });
  assert(a4 === false, "addressee hint should suppress Vi response when hint points elsewhere");

  const a5 = inferAddressedToVi({
    message: "nice weather",
    context: groupCtx,
    viName: "vi",
  });
  assert(a5 === false, "ambiguous non-directed group utterance should not default to Vi");

  console.log("- [PASS] D5 mixed-environment addressing invariants");
}

run();
