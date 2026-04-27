# 10 — Phase B extraction checklist (top 10 salvage rows only)

Status: Archived migration checklist (not active execution authority)

Authority: Historical planning reference only; active execution authority is `14-v1-contract-implementation-checklist.md`  
Scope: **checklist only** — no code, no implementation in this step.

**Physical source:** paths below are **inside** `Old Repos/*.zip` roots (e.g. `Tentai Ecosystem/...`, `vi-discord-bot/...`).

---

## B1 — Client adapter law

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/clients/CLIENT_ADAPTER_RULES.ts` |
| **2. Problem** | Clients smuggling persona, tone overrides, or mutating model output; identity not normalized before core. |
| **3. North Star** | Enforces **module sovereignty**: ports adapt I/O; Vi Core owns behavior and state (`08`). |
| **4. Extraction** | **pattern only** (rules + validation checklist + test template). |
| **5. Landing zone** | `vi/docs/architecture/` (short **Module adapter contract** appendix or ADR); later: `vi/apps/api` request validation / tests when Discord (or other) adapter ships. |
| **6. Definition of done** | Written contract lists forbidden override keys; checklist exists for “identity before chat”; at least one **automated** adapter-compliance test stub is specified (not necessarily implemented in this doc). |
| **7. Risk / do not import** | Do not copy Discord-specific headers verbatim as law if new API differs; do not treat string-scan `validateResponseHandling` as sufficient security — it is illustrative only. |

---

## B2 — Authoritative clock

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/runtime/timeService.ts` |
| **2. Problem** | Model or scattered call sites “guessing” now; inconsistent epoch vs ISO. |
| **3. North Star** | **Chronos truth layer** — single factual clock for all duration and “wall now” derivations (`06`, `08`). |
| **4. Extraction** | **pattern only** (one function / one module boundary: `now` → `{ utc, epochMs }`). |
| **5. Landing zone** | `vi/packages/core/src/time/` (alongside `temporalContext.ts`; keep one authority chain). |
| **6. Definition of done** | Every Chronos v2 state tick and temporal block builder reads wall time through this boundary (no duplicate `new Date()` sprawl for authority). |
| **7. Risk / do not import** | Do not conflate “authoritative clock” with **gap weight** or **interior state** — v2 state is separate fields updated from DB + turn events. |

---

## B3 — Time engine façade

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/humanity/time/TimeEngine.ts` |
| **2. Problem** | Scattered `Date.now()` at call sites; no stable place to attach telemetry or future temporal policy. |
| **3. North Star** | Clean **engine boundary** for time reads + optional observability without leaking false phenomenology. |
| **4. Extraction** | **structure adaptation** (thin façade; drop “humanity” naming; keep shape: `now({ userId?, sessionId? })`). |
| **5. Landing zone** | `vi/packages/core/src/time/` (e.g. `chronosClock.ts` or fold into a single `ChronosService` façade — pick one during implementation). |
| **6. Definition of done** | All user-facing time metadata for a turn flows: clock → temporal context builder → prompt; façade is the only injection point for “instrument now.” |
| **7. Risk / do not import** | Do not import telemetry coupling that implies felt experience; keep events factual (`08`). |

---

## B4 — Memory curation / anti-noise

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/brain/memory/MemoryCurationPolicy.ts` |
| **2. Problem** | Long-term store fills with junk, greetings, and low-signal chat; durable vs ephemeral conflated. |
| **3. North Star** | **Memory weighting** and evidence discipline — only persist what survives explicit rules (`07`, `08`). |
| **4. Extraction** | **pattern only** (rule-first pipeline: normalize → classify → drop junk → emit candidate records). |
| **5. Landing zone** | `vi/packages/core/src/memory/` (new, small) or `vi/packages/orchestration/` if first consumer is recall/write path — **one** place only. |
| **6. Definition of done** | Any new memory write path (when added) runs through curation gates; default is **no write** unless rules pass; unit tests cover junk + edge cases from old patterns. |
| **7. Risk / do not import** | Do not copy domain-specific regex buckets (lore/product names) wholesale; re-derive rules for **this** Vi’s vocabulary and user. |

---

## B5 — Grounded memory resolution

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/brain/grounding/MemoryResolver.ts` |
| **2. Problem** | When canon/context is thin, system invents or free-associates instead of **retrieving with limits**. |
| **3. North Star** | Evidence-bound recall; **failure behavior** — empty result is valid (`06`); supports continuity without hallucination. |
| **4. Extraction** | **structure adaptation** (interface: query → ranked citations; dimension filters; confidence caps). |
| **5. Landing zone** | `vi/packages/orchestration/` (recall path) + `vi/packages/db/` (read APIs) — resolver stays orchestration-side, storage stays db-side. |
| **6. Definition of done** | Recall path returns structured citations or explicit empty; never silent “pretend we remembered”; thresholds configurable. |
| **7. Risk / do not import** | Do not import optional chaining stubs that mask missing repo methods; wire to **real** repositories or delete the code path. |

---

## B6 — Memory strategy ADR

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/docs/90-adr/002-memory-strategy.md` |
| **2. Problem** | Undocumented memory split → teams ship “log everything” or duplicate stores. |
| **3. North Star** | Governance for **memory weighting** and Jarvis rule: memory must affect live path or stay out (`08`). |
| **4. Extraction** | **pattern only** (invariants list: authority order, write gates, what not to persist). |
| **5. Landing zone** | `vi/docs/architecture/` (short ADR: **Memory authority v1** — references this checklist row, not the old file text dump). |
| **6. Definition of done** | New ADR lists ≤10 non-negotiables; links to `07` / `08`; engineers can answer “where does this memory live?” in one sentence. |
| **7. Risk / do not import** | Do not import old schema names as if current DB matched; treat old ADR as **idea mine** only. |

---

## B7 — Bounded embed queue

| Field | Content |
|--------|---------|
| **1. Source path** | `vi-discord-bot/apps/memory/src/lib/queue.ts` |
| **2. Problem** | Embedding/indexing blocks chat; failures lose work or retry storm. |
| **3. North Star** | **Bounded processing** — async work with retries/backoff, separate from turn latency (`08`). |
| **4. Extraction** | **structure adaptation** (job shape, worker boundary, retry policy — infra may be Redis/BullMQ or simpler queue later). |
| **5. Landing zone** | `vi/apps/api/` (worker entry or job producer) **or** a future `vi/packages/jobs/` — only if Phase B actually adds async indexing; else **defer** after DoD for B4/B5. |
| **6. Definition of done** | Chat POST path never awaits full embed; failed jobs surface in logs/metrics; retry policy documented. |
| **7. Risk / do not import** | Do not pull Redis/BullMQ as mandatory dependency until needed; do not run “background cognition” — only **bounded mechanical** jobs. |

---

## B8 — Embedder health and degradation

| Field | Content |
|--------|---------|
| **1. Source path** | `vi-discord-bot/apps/memory/src/lib/embed.ts` |
| **2. Problem** | Silent embed failures or mystery vectors; prod unclear which mode is active. |
| **3. North Star** | Honest **known vs unknown** for subsystem health (`06`); supports weighting only when signal is real. |
| **4. Extraction** | **pattern only** (`init` + health DTO + explicit fallback mode naming). |
| **5. Landing zone** | Same as B7 landing candidate, or `vi/apps/api` `/health` enrichment — co-locate with embed worker if B7 ships. |
| **6. Definition of done** | Health endpoint or structured log reports `ready | degraded | unavailable` with reason string; no silent “fake embed” without labeling. |
| **7. Risk / do not import** | Do not treat hashed BOW fallback as semantic-quality retrieval without documenting precision loss. |

---

## B9 — Conversation turn signals (gating)

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/runtime/conversationTurnSignals.ts` |
| **2. Problem** | Every ping pays full LLM cost; check-ins mixed with deep work. |
| **3. North Star** | **Decision causality** — route by policy before expensive steps; must not violate relevance / natural mention contracts. |
| **4. Extraction** | **structure adaptation** (keep staged decision; **rebuild** rules with tests — do not bulk-port regex). |
| **5. Landing zone** | `vi/packages/orchestration/src/runTurn.ts` precursor hooks **or** `vi/apps/api` pre-router — smallest surface that gates `runTurn` cost. |
| **6. Definition of done** | Documented matrix: which user shapes → full turn vs lighter path; tests for false positives (“how are you?” vs technical “ping”); no change to Openness law / false phenomenology. |
| **7. Risk / do not import** | Do not let gating block **mandatory** system blocks (e.g. temporal context) or user safety paths; do not use satisfaction regex as truth (`09` evaluation.ts stayed out of top 10 intentionally). |

---

## B10 — Continuity pack (slice only)

| Field | Content |
|--------|---------|
| **1. Source path** | `Tentai Ecosystem/core/vi/src/brain/memory/MemoryOrchestrator.ts` |
| **2. Problem** | Fragmented identity + prefs + memory layers → inconsistent “who is Vi talking to.” |
| **3. North Star** | **Continuity** axis — one pack concept for cross-surface behavior **without** importing the whole old graph (`08` minimal stack). |
| **4. Extraction** | **structure adaptation** (**slice**: identity + one memory layer + explicit “not yet” fields — not full orchestrator). |
| **5. Landing zone** | `vi/packages/db/` (read model) + `vi/packages/orchestration/` (assembly) — types in `vi/packages/shared` if shared across API and web. |
| **6. Definition of done** | One function or module builds a **minimal** continuity DTO for a `vi_user_id` + session; unknown fields stay null with explicit “not wired”; first consumer proves Jarvis: pack changes prompt or tool policy measurably. |
| **7. Risk / do not import** | Do not import `RelationshipResolver`, missions, or multi-repo tables in one PR; do not duplicate old “legacy fields” unless migration is real. |

---

## Phase B execution order (recommended)

1. **B2 -> B3** (clock + facade) as substrate for Chronos v2 state.  
2. **B6** (ADR invariants) before any large memory write.  
3. **B4 -> B5** (curation before resolver wiring).  
4. **B1** in parallel as **law** for any new client.  
5. **B7 -> B8** only if semantic indexing is in-scope for this Phase B slice.  
6. **B9** after temporal + recall paths are stable (avoid double gating).  
7. **B10** last — smallest slice that proves continuity affects behavior.

---

## Single gate before closing Phase B

- [ ] Demonstrate **time -> state -> observable behavior** on one scripted absence-return scenario (no new phenomenology claims).  
- [ ] Demonstrate **memory weighting** rejects at least one class of junk the old curation caught.  
- [ ] **Module sovereignty:** no client-only persona path; adapter contract referenced in review.
