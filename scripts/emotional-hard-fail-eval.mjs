import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getArg(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function normalizeReply(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(haystack, needles) {
  const lc = (haystack ?? "").toLowerCase();
  return needles.filter((n) => lc.includes(n.toLowerCase()));
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

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const apiBaseUrl = getArg("apiBaseUrl") ?? process.env.PHASE2_EVAL_API_BASE_URL ?? "http://127.0.0.1:3001";
  const casePath =
    getArg("cases") ?? path.resolve(repoRoot, "eval", "emotional-hard-fail-cases.json");

  const raw = await readFile(casePath, "utf8");
  const cfg = JSON.parse(raw);
  const cases = cfg.cases ?? [];
  if (!Array.isArray(cases) || cases.length < 2) {
    throw new Error("emotional hard-fail eval requires at least two cases");
  }

  let sessionId = null;
  let prevNormReply = null;
  const results = [];

  for (const c of cases) {
    if (c.startNewSession) {
      sessionId = null;
      prevNormReply = null;
    }
    const { response, data } = await postChat(apiBaseUrl, c.prompt, sessionId);
    const entry = {
      id: c.id,
      prompt: c.prompt,
      failures: [],
      reply: data?.reply ?? "",
      http: response.status,
    };
    if (!response.ok) {
      entry.failures.push(`HTTP ${response.status}`);
      results.push(entry);
      continue;
    }
    sessionId = data.sessionId;
    const reply = data?.reply ?? "";
    const normReply = normalizeReply(reply);

    const missing = includesAny(reply, c.mustIncludeAny ?? []);
    if ((c.mustIncludeAny ?? []).length > 0 && missing.length === 0) {
      entry.failures.push(`missing question-specific signal (${(c.mustIncludeAny ?? []).join(" | ")})`);
    }

    const forbiddenHits = includesAny(reply, c.mustExcludeAny ?? []);
    if (forbiddenHits.length > 0) {
      entry.failures.push(`contains forbidden signal: ${forbiddenHits.join(" | ")}`);
    }

    if (prevNormReply && normReply === prevNormReply) {
      entry.failures.push("repeated fallback line across turns");
    }
    prevNormReply = normReply;
    results.push(entry);
  }

  let passCount = 0;
  for (const r of results) {
    const ok = r.failures.length === 0;
    if (ok) passCount += 1;
    console.log(`- [${ok ? "PASS" : "FAIL"}] ${r.id}`);
    if (!ok) {
      for (const f of r.failures) console.log(`    - ${f}`);
      console.log(`    prompt: ${r.prompt}`);
      console.log(`    reply: ${r.reply}`);
    }
  }
  console.log("");
  console.log(`Emotional hard-fail eval ${cfg.version}: ${passCount}/${results.length} case-level pass`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
