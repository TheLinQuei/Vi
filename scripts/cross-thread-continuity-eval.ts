import assert from "node:assert/strict";
import {
  applyCrossThreadContinuityFromUserMessage,
  parseUserGlobalContinuityState,
} from "../apps/api/src/idle/userGlobalRuntime.js";

function run(): void {
  const base = parseUserGlobalContinuityState(null);
  const sessionA = applyCrossThreadContinuityFromUserMessage(base, "count with me to ten");
  assert.equal(sessionA.crossThread.countToTenProgress, 1, "expected count state initialization");

  const sessionB = applyCrossThreadContinuityFromUserMessage(sessionA, "2");
  assert.equal(sessionB.crossThread.countToTenProgress, 2, "expected cross-session progress carry");

  const sessionC = applyCrossThreadContinuityFromUserMessage(sessionB, "3");
  assert.equal(sessionC.crossThread.countToTenProgress, 3, "expected continuity to continue");

  console.log("cross-thread continuity eval passed");
}

run();
