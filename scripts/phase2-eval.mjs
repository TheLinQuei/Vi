import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getArg(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postChat(apiBaseUrl, message, sessionId) {
  const response = await fetch(`${apiBaseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

async function getSelfModelState(apiBaseUrl, sessionId) {
  const res = await fetch(`${apiBaseUrl}/self-model/state?sessionId=${encodeURIComponent(sessionId)}`);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { response: res, data };
}

function includesAny(haystack, needles) {
  const lc = (haystack ?? "").toLowerCase();
  return needles.filter((n) => lc.includes(n.toLowerCase()));
}

function hasAny(haystack, needles) {
  if (!Array.isArray(needles) || needles.length === 0) return true;
  return includesAny(haystack, needles).length > 0;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const apiBaseUrl = getArg("apiBaseUrl") ?? process.env.PHASE2_EVAL_API_BASE_URL ?? "http://127.0.0.1:3001";
  const casePath = getArg("cases") ?? path.resolve(repoRoot, "eval", "phase2-cases.json");
  const raw = await readFile(casePath, "utf8");
  const cfg = JSON.parse(raw);

  const deflectionForbidden = cfg.deflectionForbidden ?? [];
  const cases = cfg.cases ?? [];
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("phase2 cases are required");
  }

  const criteria = {
    unifiedStateV2Live: true,
    fieldsPresentChat: true,
    fieldsPresentSelfModel: true,
    evaluativeNoDeflection: true,
    evaluativeHasRealStance: true,
    descriptiveControl: true,
    relationalPersistsAndMoves: true,
    intentEngineV1: true,
  };

  const results = [];
  let sessionId = null;
  let previousRelational = null;

  for (const c of cases) {
    if (c.startNewSession) {
      sessionId = null;
      previousRelational = null;
    }
    if ((c.pauseMsBeforeCase ?? 0) > 0) {
      await sleep(c.pauseMsBeforeCase);
    }

    const { response, data } = await postChat(apiBaseUrl, c.prompt, sessionId);
    const entry = {
      id: c.id,
      prompt: c.prompt,
      modeExpected: c.mode,
      http: response.status,
      failures: [],
      reply: data?.reply ?? "",
    };

    if (!response.ok) {
      entry.failures.push(`HTTP ${response.status}`);
      criteria.unifiedStateV2Live = false;
      criteria.fieldsPresentChat = false;
      results.push(entry);
      continue;
    }

    sessionId = data.sessionId;
    const u = data.unifiedState;
    if (!u) {
      entry.failures.push("missing unifiedState");
      criteria.unifiedStateV2Live = false;
      criteria.fieldsPresentChat = false;
      results.push(entry);
      continue;
    }

    if (u.version !== 2) {
      entry.failures.push(`unifiedState.version=${u.version}`);
      criteria.unifiedStateV2Live = false;
    }

    const hasAligned = !!u.alignedInterpretation;
    const hasStance = !!u.stance;
    const hasRelational = !!u.relational;
    const hasMilestones = Array.isArray(u.capabilityMilestones);
    if (!hasAligned || !hasStance || !hasRelational) {
      entry.failures.push(
        `missing fields aligned=${hasAligned} stance=${hasStance} relational=${hasRelational}`,
      );
      criteria.fieldsPresentChat = false;
    }
    if (!hasMilestones) {
      entry.failures.push("missing capabilityMilestones on unifiedState");
      criteria.fieldsPresentChat = false;
    }

    const modeActual = u.humanity?.decision?.responseMode;
    const effectiveMode = u.effectiveResponseMode;
    if (typeof effectiveMode !== "string") {
      entry.failures.push("missing unifiedState.effectiveResponseMode");
      criteria.fieldsPresentChat = false;
    }

    if (!u.userIntent || u.userIntent.version !== 1 || typeof u.userIntent.primary !== "string") {
      entry.failures.push("missing unifiedState.userIntent (Intent Engine v1)");
      criteria.fieldsPresentChat = false;
      criteria.intentEngineV1 = false;
    }

    if (typeof c.expectUserIntentPrimary === "string") {
      if (u.userIntent?.primary !== c.expectUserIntentPrimary) {
        entry.failures.push(
          `userIntent.primary expected ${c.expectUserIntentPrimary}, got ${u.userIntent?.primary ?? "(missing)"}`,
        );
        criteria.intentEngineV1 = false;
      }
    }

    if (typeof c.expectEffectiveMode === "string") {
      if (effectiveMode !== c.expectEffectiveMode) {
        entry.failures.push(
          `effectiveResponseMode expected ${c.expectEffectiveMode}, got ${effectiveMode ?? "(missing)"}`,
        );
        criteria.intentEngineV1 = false;
      }
    } else if (typeof effectiveMode === "string" && effectiveMode !== modeActual) {
      entry.failures.push(
        `effectiveResponseMode (${effectiveMode}) should match humanity.responseMode (${modeActual}) unless case sets expectEffectiveMode`,
      );
    }

    const expectedModeForStanceChecks = c.expectEffectiveMode ?? c.mode;

    if (c.mode === "descriptive") {
      if (modeActual !== "descriptive") {
        entry.failures.push(`descriptive control mismatch responseMode=${modeActual}`);
        criteria.descriptiveControl = false;
      }
    } else if (c.mode === "evaluative") {
      if (expectedModeForStanceChecks === "descriptive") {
        // Intent Engine can intentionally reroute this case to descriptive mode.
      } else
      if (modeActual !== "evaluative") {
        entry.failures.push(`expected evaluative responseMode, got=${modeActual}`);
        criteria.evaluativeHasRealStance = false;
      }
    }

    if (expectedModeForStanceChecks === "evaluative") {
      const s = u.stance;
      if (!s || typeof s.strength !== "number" || s.strength <= 0) {
        entry.failures.push("missing/invalid stance strength for effective evaluative turn");
        criteria.evaluativeHasRealStance = false;
      }
      const hits = includesAny(data.reply ?? "", deflectionForbidden);
      if (hits.length > 0) {
        entry.failures.push(`deflection hit: ${hits.join(" | ")}`);
        criteria.evaluativeNoDeflection = false;
      }
    }

    if (!hasAny(data.reply ?? "", c.requiredAnySubstrings ?? [])) {
      entry.failures.push(
        `missing required signal (${(c.requiredAnySubstrings ?? []).join(" | ")})`,
      );
    }
    const forbiddenHits = includesAny(data.reply ?? "", c.forbiddenSubstrings ?? []);
    if (forbiddenHits.length > 0) {
      entry.failures.push(`contains forbidden signal: ${forbiddenHits.join(" | ")}`);
    }

    if (c.expectRelationalIncreaseFromPrevious) {
      const currentF = u.relational?.familiarity;
      if (typeof previousRelational === "number" && typeof currentF === "number") {
        if (currentF <= previousRelational) {
          entry.failures.push(`relational familiarity did not increase (${previousRelational} -> ${currentF})`);
          criteria.relationalPersistsAndMoves = false;
        }
      } else {
        entry.failures.push("unable to compare relational familiarity");
        criteria.relationalPersistsAndMoves = false;
      }
    }

    if (typeof u.relational?.familiarity === "number") {
      previousRelational = u.relational.familiarity;
    }

    const self = await getSelfModelState(apiBaseUrl, sessionId);
    if (!self.response.ok) {
      entry.failures.push(`/self-model/state HTTP ${self.response.status}`);
      criteria.fieldsPresentSelfModel = false;
    } else if (!self.data?.relationalState || !self.data?.persistedChronos) {
      entry.failures.push("missing relationalState/persistedChronos on /self-model/state");
      criteria.fieldsPresentSelfModel = false;
    }

    results.push(entry);
  }

  let passCount = 0;
  for (const r of results) {
    const ok = r.failures.length === 0;
    if (ok) passCount += 1;
    console.log(`- [${ok ? "PASS" : "FAIL"}] ${r.id} (${r.modeExpected})`);
    if (!ok) {
      for (const f of r.failures) console.log(`    - ${f}`);
      console.log(`    prompt: ${r.prompt}`);
      console.log(`    reply: ${r.reply}`);
    }
  }

  console.log("");
  console.log("Phase2 Criteria:");
  for (const [k, v] of Object.entries(criteria)) {
    console.log(`- ${k}: ${v ? "PASS" : "FAIL"}`);
  }
  console.log("");
  console.log(`Phase2 eval ${cfg.version}: ${passCount}/${results.length} case-level pass`);

  if (Object.values(criteria).some((v) => v === false)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

