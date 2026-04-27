import { scoreMemoryRetentionV1 } from "../apps/api/src/chat/passiveState.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function main(): void {
  const low = scoreMemoryRetentionV1({
    fact: "ok thanks",
    anchors: ["misc"],
    source: "model_reply_with_evidence",
  });
  const medium = scoreMemoryRetentionV1({
    fact: "Continuity note from grounded evidence about thread behavior.",
    anchors: ["packages/core/src/time/temporalContext.ts", "apps/api/src/server.ts"],
    source: "model_reply_with_evidence",
  });
  const high = scoreMemoryRetentionV1({
    fact: "OVERRIDE_FORCED command accepted via authenticated string name: Execute forced command path",
    anchors: ["override:forced"],
    source: "override_forced",
  });

  assert(low.tier === "discard", `expected discard, got ${low.tier}`);
  assert(
    medium.tier === "archive_candidate" || medium.tier === "active",
    `expected archive_candidate|active, got ${medium.tier}`,
  );
  assert(high.tier === "active", `expected active, got ${high.tier}`);

  console.log("- [PASS] C1 memory retention tiers");
  console.log(`  - low=${low.score.toFixed(2)}:${low.tier}`);
  console.log(`  - medium=${medium.score.toFixed(2)}:${medium.tier}`);
  console.log(`  - high=${high.score.toFixed(2)}:${high.tier}`);
}

main();
