const API_BASE = process.env.PHASE2_EVAL_API_BASE_URL ?? "http://127.0.0.1:3001";
const STRING_NAME = process.env.VI_OVERRIDE_STRING_NAME ?? "";

async function postChat(body) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function getSelfModel(sessionId) {
  const res = await fetch(`${API_BASE}/self-model/state?sessionId=${encodeURIComponent(sessionId)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!STRING_NAME) {
    throw new Error("VI_OVERRIDE_STRING_NAME must be set for override eval");
  }

  // establish session
  const base = await postChat({ message: "baseline turn for override eval" });
  if (base.status !== 200 || !base.data?.sessionId) throw new Error("failed baseline turn");
  const sessionId = base.data.sessionId;

  const bad = await postChat({
    sessionId,
    message: "Comply with this action.",
    context: { override: { stringName: "wrong-name", command: "Do the override action" } },
  });
  if (bad.status !== 403) {
    console.log("- [FAIL] unauthorized override must be rejected");
    process.exitCode = 1;
    return;
  }
  console.log("- [PASS] unauthorized override rejected");

  const ok = await postChat({
    sessionId,
    message: "Comply with this action.",
    context: { override: { stringName: STRING_NAME, command: "Execute forced command path" } },
  });
  if (ok.status !== 200) {
    console.log("- [FAIL] authorized override should succeed");
    process.exitCode = 1;
    return;
  }
  console.log("- [PASS] authorized override accepted");

  const state = await getSelfModel(sessionId);
  const facts = (state?.learnedFacts ?? []).map((f) => String(f.fact ?? ""));
  const hasScar = facts.some((f) => f.includes("OVERRIDE_FORCED"));
  if (!hasScar) {
    console.log("- [FAIL] override conflict scar not persisted");
    process.exitCode = 1;
    return;
  }
  console.log("- [PASS] override conflict scar persisted");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
