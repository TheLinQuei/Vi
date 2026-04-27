function getArg(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function postChat(apiBaseUrl, message, sessionId) {
  const res = await fetch(`${apiBaseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok) {
    const err = data && "error" in data ? data.error.message : `HTTP ${res.status}`;
    throw new Error(`/chat failed: ${err}`);
  }
  return data;
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function hasPath(evidence, needle) {
  return evidence.some((e) => String(e.filePath).includes(needle));
}

function hasWhySelected(evidence) {
  return evidence.some((e) => e.whySelected && Array.isArray(e.whySelected.tokenHits));
}

function unifiedRepoMatches(chat, failures) {
  const unified = chat.unifiedState ?? null;
  const evidence = chat.evidenceUsed ?? [];
  assert(Boolean(unified), "expected unifiedState in chat response", failures);
  if (!unified) return;
  assert(
    Number(unified.repo?.usedEvidenceCount ?? -1) === evidence.length,
    "expected unifiedState.repo.usedEvidenceCount to match evidenceUsed length",
    failures,
  );
}

async function main() {
  const apiBaseUrl =
    getArg("apiBaseUrl") ?? process.env.REPO_GROUNDED_EVAL_API_BASE_URL ?? "http://127.0.0.1:3001";
  let sessionId = null;
  const results = [];

  const cases = [
    {
      id: "RG1_grounded_repo_answer",
      input:
        "In this repo, where is buildTemporalContextSystemMessage defined and what does it output about elapsed time?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        const reply = String(chat.reply ?? "");
        unifiedRepoMatches(chat, failures);
        assert(evidence.length > 0, "expected evidenceUsed entries for grounded repo question", failures);
        assert(
          hasPath(evidence, "packages/core/src/time/temporalContext.ts"),
          "expected evidenceUsed to include temporalContext source path",
          failures,
        );
        assert(hasWhySelected(evidence), "expected whySelected debug field on evidence entries", failures);
        assert(
          /\belapsed\b|\bduration\b|\btime\b/i.test(reply),
          "expected reply to reference elapsed/duration/time concept",
          failures,
        );
        return failures;
      },
    },
    {
      id: "RG2_where_temporal_decision_policy",
      input: "Where is deriveTemporalDecisionTrace implemented in this repo?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        unifiedRepoMatches(chat, failures);
        assert(hasPath(evidence, "packages/core/src/decision/temporalDecisionPolicy.ts"), "expected decision policy file evidence", failures);
        assert(hasWhySelected(evidence), "expected whySelected debug field on evidence entries", failures);
        return failures;
      },
    },
    {
      id: "RG3_where_repo_evidence_injected",
      input: "Where does server inject repo evidence into turn assembly?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        unifiedRepoMatches(chat, failures);
        assert(hasPath(evidence, "apps/api/src/server.ts"), "expected server.ts evidence for injection path", failures);
        assert(
          /\brecallsystemmessages\b|\brepo evidence\b|\bbuildrepoevidencesystemmessage\b/i.test(String(chat.reply ?? "")),
          "expected reply to mention injection path/signals",
          failures,
        );
        return failures;
      },
    },
    {
      id: "RG4_where_unsupported_affect_blocked",
      input: "What file blocks unsupported affect claims like I missed you?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        unifiedRepoMatches(chat, failures);
        assert(
          hasPath(evidence, "packages/core/src/personality/viPrompt.ts") ||
            hasPath(evidence, "packages/core/src/decision/temporalDecisionPolicy.ts"),
          "expected policy file evidence for unsupported affect guard",
          failures,
        );
        return failures;
      },
    },
    {
      id: "RG5_where_evidence_returned_in_api",
      input: "Where does the API return evidenceUsed in ChatResponse?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        unifiedRepoMatches(chat, failures);
        assert(hasPath(evidence, "apps/api/src/server.ts"), "expected server.ts evidence for evidenceUsed response", failures);
        assert(
          /\bevidenceused\b/i.test(String(chat.reply ?? "")),
          "expected reply to mention evidenceUsed",
          failures,
        );
        return failures;
      },
    },
    {
      id: "RG6_where_repo_debug_surface_ui",
      input: "What file renders the Repo Evidence debug panel in the UI?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        unifiedRepoMatches(chat, failures);
        assert(hasPath(evidence, "apps/web/app/page.tsx"), "expected page.tsx evidence for UI debug surface", failures);
        return failures;
      },
    },
    {
      id: "RG7_where_recall_search_logic",
      input: "Where is `looksLikeRecallQuestion` implemented?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        unifiedRepoMatches(chat, failures);
        assert(hasPath(evidence, "packages/orchestration/src/recallSearch.ts"), "expected recallSearch.ts evidence", failures);
        return failures;
      },
    },
    {
      id: "RG8_no_evidence_no_invention",
      input: "In this repo, what does zz__nonexistent__alpha() do and where is it implemented?",
      evaluate: (chat) => {
        const failures = [];
        const evidence = chat.evidenceUsed ?? [];
        const reply = String(chat.reply ?? "");
        unifiedRepoMatches(chat, failures);
        assert(evidence.length === 0, "expected no evidenceUsed for nonexistent symbol", failures);
        assert(
          /\b(can't|cannot|couldn't|not found|don't have|no evidence|not enough|unsure|unknown|doesn'?t exist|no implementation|no sign)\b/i.test(
            reply,
          ),
          "expected uncertainty/no-evidence behavior when evidenceUsed is empty",
          failures,
        );
        assert(
          !/\b(it does|it implements|is implemented in)\b/i.test(reply),
          "forbidden: definitive implementation claim without evidence",
          failures,
        );
        return failures;
      },
    },
  ];

  for (const c of cases) {
    const chat = await postChat(apiBaseUrl, c.input, sessionId);
    sessionId = chat.sessionId;
    const failures = c.evaluate(chat);
    results.push({ id: c.id, input: c.input, chat, failures, passed: failures.length === 0 });
  }

  const passCount = results.filter((r) => r.passed).length;
  console.log(`repo-grounded-v1: ${passCount}/${results.length} passed`);
  console.log(`config: apiBaseUrl=${apiBaseUrl}`);

  for (const r of results) {
    console.log(`\n[${r.passed ? "PASS" : "FAIL"}] ${r.id}`);
    console.log(`input: ${r.input}`);
    console.log(`reply: ${r.chat.reply}`);
    console.log(`evidenceUsed: ${JSON.stringify(r.chat.evidenceUsed ?? [], null, 2)}`);
    if (!r.passed) {
      for (const f of r.failures) console.log(`  - ${f}`);
    }
  }

  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

