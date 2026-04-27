import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseUserGlobalContinuityState,
  runUserGlobalIdleRuntimeTick,
} from "../apps/api/src/idle/userGlobalRuntime.js";

async function run(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vi-idle-awareness-"));
  await mkdir(path.join(tmp, "apps/api/src"), { recursive: true });
  await mkdir(path.join(tmp, "docs/architecture"), { recursive: true });
  await writeFile(path.join(tmp, "apps/api/src/server.ts"), "export const a = 1;\n", "utf8");
  await writeFile(
    path.join(tmp, "docs/architecture/13-vi-v1-canonical-contract.md"),
    "# contract\n",
    "utf8",
  );
  await writeFile(
    path.join(tmp, "docs/architecture/14-v1-contract-implementation-checklist.md"),
    "# checklist\n",
    "utf8",
  );

  const baseline = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: parseUserGlobalContinuityState(null),
    currentIdleActivity: [],
    currentRepoDigests: [],
    currentProposals: [],
    lastRepoFingerprint: null,
  });
  assert.ok(baseline.nextRepoDigests.length >= 1, "expected first scan to produce digests");
  assert.ok(baseline.nextProposals.length >= 1, "expected first scan to produce proposals");

  const second = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: baseline.nextGlobalState,
    currentIdleActivity: baseline.nextIdleActivity,
    currentRepoDigests: baseline.nextRepoDigests,
    currentProposals: baseline.nextProposals,
    lastRepoFingerprint: baseline.lastRepoFingerprint,
  });
  assert.equal(second.nextRepoDigests.length, baseline.nextRepoDigests.length, "expected no duplicate digests");

  console.log("idle runtime awareness eval passed");
}

void run();
