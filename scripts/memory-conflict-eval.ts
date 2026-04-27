import { applyMemoryConflictResolution, type PassiveSessionState } from "../apps/api/src/chat/passiveState.ts";

function makeState(): PassiveSessionState {
  return {
    lastBackgroundActivityAt: null,
    pendingReflections: [],
    lastTemporalState: null,
    lastDecisionTrace: null,
    lastRepoEvidence: null,
    learnedFacts: [],
    lastUnifiedState: null,
  };
}

function main(): void {
  const s = makeState();

  const r1 = applyMemoryConflictResolution({ passive: s, userMessage: "My favorite color is blue." });
  const after1 = s.learnedFacts.map((f) => f.fact);
  const hasBlue = after1.some((f) => /favorite color.*blue/i.test(f));

  const r2 = applyMemoryConflictResolution({ passive: s, userMessage: "My favorite color is green." });
  const after2 = s.learnedFacts.map((f) => f.fact);
  const hasClarify = after2.some((f) => f.includes("PENDING_CLARIFY"));

  const r3 = applyMemoryConflictResolution({
    passive: s,
    userMessage: "Actually, my favorite color is green.",
  });
  const after3 = s.learnedFacts.map((f) => f.fact);
  const hasEvolution = after3.some((f) => f.includes("EVOLUTION_UPDATE"));
  const hasBlueActive = after3.some((f) => /favorite color.*blue/i.test(f) && !f.includes("supersedes"));
  const hasGreen = after3.some((f) => /favorite color.*green/i.test(f));

  const failures: string[] = [];
  if (r1 !== "none") failures.push(`step1 expected none, got ${r1}`);
  if (!hasBlue) failures.push("step1 missing initial fact");
  if (r2 !== "clarify") failures.push(`step2 expected clarify, got ${r2}`);
  if (!hasClarify) failures.push("step2 missing clarify marker");
  if (r3 !== "updated") failures.push(`step3 expected updated, got ${r3}`);
  if (!hasEvolution) failures.push("step3 missing evolution update marker");
  if (hasBlueActive) failures.push("step3 old conflicting active fact still present");
  if (!hasGreen) failures.push("step3 corrected value not present");

  if (failures.length > 0) {
    console.log("- [FAIL] C3 memory conflict invariants");
    for (const f of failures) console.log(`  - ${f}`);
    console.log("- learned facts snapshot:");
    for (const f of after3.slice(0, 8)) console.log(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log("- [PASS] C3 memory conflict invariants");
  console.log("- [PASS] challenge/clarify/update evolution path is deterministic");
}

main();
