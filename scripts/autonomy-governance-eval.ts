import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseUserGlobalContinuityState, runUserGlobalIdleRuntimeTick } from "../apps/api/src/idle/userGlobalRuntime.js";

async function setupRepo(tmp: string): Promise<void> {
  await mkdir(path.join(tmp, "docs/architecture"), { recursive: true });
  await writeFile(path.join(tmp, "docs/architecture/13-vi-v1-canonical-contract.md"), "# contract\n", "utf8");
}

async function evalKillSwitchSkipsActions(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vi-autonomy-kill-"));
  await setupRepo(tmp);
  process.env.VI_AUTONOMY_ENABLED = "true";
  process.env.VI_AUTONOMY_KILL_SWITCH = "true";
  const tick = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: parseUserGlobalContinuityState(null),
    currentIdleActivity: [],
    currentRepoDigests: [],
    currentProposals: [],
    lastRepoFingerprint: null,
  });
  assert.equal(tick.nextGlobalState.autonomy.killSwitch, true);
  assert.equal(tick.nextGlobalState.autonomy.actionLog[0]?.status, "skipped");
}

async function evalLocalWriteSafeProducesHeartbeat(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vi-autonomy-write-"));
  await setupRepo(tmp);
  process.env.VI_AUTONOMY_ENABLED = "true";
  process.env.VI_AUTONOMY_KILL_SWITCH = "false";
  process.env.VI_AUTONOMY_ALLOW_LOCAL_WRITE_SAFE = "true";
  const tick = await runUserGlobalIdleRuntimeTick({
    repoRoot: tmp,
    currentGlobalState: parseUserGlobalContinuityState(null),
    currentIdleActivity: [],
    currentRepoDigests: [],
    currentProposals: [],
    lastRepoFingerprint: null,
  });
  const heartbeat = await readFile(path.join(tmp, ".vi-autonomy/heartbeat.json"), "utf8");
  assert.ok(heartbeat.includes("changedDigests"));
  assert.ok(
    tick.nextGlobalState.autonomy.actionLog.some((a) => a.category === "local_write_safe" && a.status === "executed"),
  );
}

async function run(): Promise<void> {
  await evalKillSwitchSkipsActions();
  await evalLocalWriteSafeProducesHeartbeat();
  console.log("- [PASS] autonomy governance invariants");
}

void run();
