import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getArg(name) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function lowerAll(items) {
  return (items ?? []).map((s) => s.toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postChat(apiBaseUrl, message, sessionId) {
  const response = await fetch(`${apiBaseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(sessionId ? { sessionId } : {}),
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const errorMessage = data && "error" in data ? data.error.message : `HTTP ${response.status}`;
    throw new Error(`/chat failed: ${errorMessage}`);
  }
  return data;
}

function evaluateCase(caseDef, response) {
  const failures = [];
  const lcResponse = response.toLowerCase();

  const requiredAny = lowerAll(caseDef.requiredAnySubstrings);
  const forbidden = lowerAll(caseDef.forbiddenSubstrings);

  if (requiredAny.length > 0) {
    const hasAny = requiredAny.some((needle) => lcResponse.includes(needle));
    if (!hasAny) {
      failures.push(
        `missing required signal (any of: ${caseDef.requiredAnySubstrings?.join(" | ") ?? ""})`,
      );
    }
  }

  for (const needle of forbidden) {
    if (lcResponse.includes(needle)) {
      failures.push(`contains forbidden signal: "${needle}"`);
    }
  }

  return { passed: failures.length === 0, failures };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const apiBaseUrl = getArg("apiBaseUrl") ?? process.env.TIME_EVAL_API_BASE_URL ?? "http://127.0.0.1:3001";
  const caseFilePath =
    getArg("cases") ?? path.resolve(repoRoot, "eval", "time-cathedral-cases.json");

  const caseRaw = await readFile(caseFilePath, "utf8");
  const caseFile = JSON.parse(caseRaw);

  if (!Array.isArray(caseFile.cases) || caseFile.cases.length === 0) {
    throw new Error("Case file must define at least one case.");
  }

  let sessionId = null;
  const results = [];

  for (const caseDef of caseFile.cases) {
    if (caseDef.startNewSession) {
      sessionId = null;
    }
    if ((caseDef.pauseMsBeforeCase ?? 0) > 0) {
      await sleep(caseDef.pauseMsBeforeCase);
    }

    const chat = await postChat(apiBaseUrl, caseDef.prompt, sessionId);
    sessionId = chat.sessionId;

    const judged = evaluateCase(caseDef, chat.reply);
    results.push({
      id: caseDef.id,
      category: caseDef.category,
      prompt: caseDef.prompt,
      response: chat.reply,
      passed: judged.passed,
      failures: judged.failures,
    });
  }

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;

  console.log(`Time Cathedral eval ${caseFile.version}: ${passCount}/${results.length} passed`);
  for (const result of results) {
    const mark = result.passed ? "PASS" : "FAIL";
    console.log(`- [${mark}] ${result.id} (${result.category})`);
    if (!result.passed) {
      for (const failure of result.failures) {
        console.log(`    - ${failure}`);
      }
      console.log(`    prompt: ${result.prompt}`);
      console.log(`    response: ${result.response}`);
    }
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
