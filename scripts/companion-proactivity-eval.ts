import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseUserGlobalContinuityState,
  runUserGlobalIdleRuntimeTick,
} from "../apps/api/src/idle/userGlobalRuntime.js";

async function setupRepoWithFile(tmp: string, relPath: string, content: string): Promise<void> {
  const full = path.join(tmp, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function evalInsufficientSignalSuppression(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vi-proactivity-signal-"));
  await setupRepoWithFile(tmp, "packages/db/src/repositories.ts", "export const x = 1;\n");

  const tick = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: parseUserGlobalContinuityState(null),
    currentIdleActivity: [],
    currentRepoDigests: [],
    currentProposals: [],
    lastRepoFingerprint: null,
  });
  assert.equal(
    tick.nextProposals.length,
    0,
    "single archive-tier change should not enqueue proactive proposal",
  );
}

async function evalActiveSignalAllowsProposal(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vi-proactivity-active-"));
  await setupRepoWithFile(tmp, "docs/architecture/13-vi-v1-canonical-contract.md", "# contract\n");

  const tick = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: parseUserGlobalContinuityState(null),
    currentIdleActivity: [],
    currentRepoDigests: [],
    currentProposals: [],
    lastRepoFingerprint: null,
  });
  assert.ok(
    tick.nextProposals.length >= 1,
    "active-tier architecture change should enqueue proactive proposal",
  );
}

async function evalCooldownSuppressesSpam(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vi-proactivity-cooldown-"));
  await setupRepoWithFile(tmp, "docs/architecture/13-vi-v1-canonical-contract.md", "# contract\n");
  const nowIso = new Date().toISOString();

  const tick = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: parseUserGlobalContinuityState(null),
    currentIdleActivity: [],
    currentRepoDigests: [],
    currentProposals: [
      {
        at: nowIso,
        title: "Review changed file: docs/architecture/13-vi-v1-canonical-contract.md",
        why: "already proposed",
        relevance: "high",
      },
    ],
    lastRepoFingerprint: null,
  });

  assert.equal(
    tick.nextProposals.length,
    1,
    "cooldown + dedupe should prevent stacking duplicate immediate proactive proposals",
  );
}

async function run(): Promise<void> {
  await evalInsufficientSignalSuppression();
  await evalActiveSignalAllowsProposal();
  await evalCooldownSuppressesSpam();
  console.log("- [PASS] companion proactivity policy invariants");
}

void run();
