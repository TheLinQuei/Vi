# 09 — Old repo salvage map (North Star aligned)

Status: Archived migration reference (not active authority)  
Owner: Architect (Shykem)  
Authority: Historical context only; active authority is `13-vi-v1-canonical-contract.md`

**Physical sources:** archives under `E:\Tentai Ecosystem\Old Repos\`  
**Logical paths below:** paths *inside* each zip’s root folder (e.g. `Tentai Ecosystem/...` inside `Tentai Ecosystem.zip`).

This map is **not** a catalog of every file. It lists material that meaningfully supports the trimmed alive core: **Chronos v2, causal state/decision, memory weighting, module sovereignty, bounded processing.**

---

## Archive reality check

| Archive | Role for salvage |
|--------|------------------|
| `Tentai Ecosystem.zip` | **Primary.** Dense prior Vi core: time, memory, continuity, adapter law, docs. |
| `vi-discord-bot.zip` | **Secondary.** Strong bounded async + vector memory patterns; also contains **reject-tier** prompt/emotion shortcuts. |
| `LoreOS.zip` | **Low.** Lore + JSON snapshots; not execution substrate for current Vi. |
| `ViBot.zip` | **Low.** Command-oriented Discord bot; little overlap with sovereign core loop. |

---

## Salvage items (canonical list)

### 1. Authoritative clock surface

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/runtime/timeService.ts` |
| **Tag** | `keep now` (as **pattern** only) |
| **Problem it solved** | Single source of “now” so timestamps are not model-guessed. |
| **North Star alignment** | Matches Chronos truth layer and “no guessed time.” Does **not** yet deliver Chronos v2 (temporal state / gap weight / behavior influence). |
| **Action** | `extract pattern only` — central time accessor; wire into v2 state updates, not copy-paste wholesale. |
| **Phase** | **Phase A** (hygiene + consistency) → **Phase B** (attach to `TemporalState`). |

---

### 2. Time engine façade + telemetry hook

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/humanity/time/TimeEngine.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Stable call site for “what time is it” plus optional observability events. |
| **North Star alignment** | Aligned with **observable** time and explicit layering; humanity naming is legacy — behavior must stay non-phenomenological per `06` / `08`. |
| **Action** | `adapt structure` — keep “engine boundary + telemetry optional”; rename/re-scope to neutral Chronos API in new core. |
| **Phase** | **Phase B**. |

---

### 3. Turn routing: substantive vs presence lane

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/runtime/conversationTurnSignals.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Avoid burning full cognition on pure check-ins; route some turns to lighter handling. |
| **North Star alignment** | Partially aligned: **decision causality** before LLM spend. Risk: hardcoded regex lists drift and can fight “natural mention” rules unless kept conservative and test-backed. |
| **Action** | `adapt structure` — reuse *idea* (gated depth), re-implement with explicit policy + tests in new runtime; do not port regex wholesale blindly. |
| **Phase** | **Phase B** (after Chronos v2 state exists) or **Phase C/D** if tied to initiative. |

---

### 4. Memory curation: durable vs junk

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/brain/memory/MemoryCurationPolicy.ts` |
| **Tag** | `keep now` (as **pattern** only) |
| **Problem it solved** | Prevent long-term memory from filling with noise; separate durable facts from ephemeral phrasing. |
| **North Star alignment** | Strong fit for **memory weighting** and evidence discipline (`07` / `08`): persist only what survives rules. |
| **Action** | `extract pattern only` — rule-first curation, re-bind to new schema and approval gates. |
| **Phase** | **Phase B** (minimal weighting) → **Phase C** (richer buckets). |

---

### 5. Continuity pack assembly (multi-layer context)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/brain/memory/MemoryOrchestrator.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Assemble identity + relationship + preferences + layered memory for a coherent “who is this thread for.” |
| **North Star alignment** | Aligns with **Continuity** axis and future cross-module identity — but current new Vi is intentionally narrower; importing whole orchestrator is **scope explosion** vs `08` minimal stack. |
| **Action** | `adapt structure` — mine interfaces and layering; re-build smallest slice that proves causal influence (Jarvis contract). |
| **Phase** | **Phase C/D**. |

---

### 6. Client adapter law (ports, not personalities)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/clients/CLIENT_ADAPTER_RULES.ts` |
| **Tag** | `reference only` (normative) + **`keep now`** for *rules text* as product law |
| **Problem it solved** | Stop Discord/Web/other clients from injecting persona, tone overrides, or mutating model output. |
| **North Star alignment** | **Direct hit** on module sovereignty in `08`: adapters do I/O only; Vi Core owns state and behavior. |
| **Action** | `extract pattern only` — translate checklist into new repo’s adapter contract + tests when Discord module lands. |
| **Phase** | **Phase A** (document + test template) → enforced in **Phase C/D** per module. |

---

### 7. Memory grounding: canon-first, memory-second

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/brain/grounding/MemoryResolver.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | When canon is insufficient, pull **cited** user memory with relevance thresholds instead of hallucinating. |
| **North Star alignment** | Fits **evidence-bound** retrieval and failure behavior; supports continuity without fake phenomenology. |
| **Action** | `adapt structure` — keep retrieval + citation shape; align with new DB/memory store and strict “unknown if not retrieved.” |
| **Phase** | **Phase B** (thread-scoped) → **Phase C** (cross-session). |

---

### 8. Post-run reflection + episodic capture (TTL)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/brain/reflector.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | After a “thought” completes, summarize outcomes and propose **what to store** (including short-TTL episodic). |
| **North Star alignment** | Overlaps **bounded processing** and artifact formation — but current `Reflector` stores broad episodic text by default; that can **fight** curation law unless gated. Must reconcile with self-model discovery (`07`) and “no theater” (`08`). |
| **Action** | `adapt structure` — reuse pipeline shape; replace always-store behavior with explicit policies + human/authority gates. |
| **Phase** | **Phase C/D**. |

---

### 9. Preference persistence from chat heuristics

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/src/brain/PreferencePersistenceEngine.ts` |
| **Tag** | `adapt later` (high risk) |
| **Problem it solved** | Detect user corrections (“be concise”, “operator mode”) and persist preferences. |
| **North Star alignment** | Useful for **agency** only if preferences remain **evidence-grounded** and auditable. Raw substring heuristics easily violate “preference from understanding” if they become silent identity edits. |
| **Action** | `adapt structure` — treat as **proposal layer** with confirmation or score thresholds; never silent overwrite of sovereign self-model. |
| **Phase** | **Phase C/D**. |

---

### 10. Cross-entity state schema (protocol)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi-protocol/src/schema/entities/state.ts` |
| **Tag** | `reference only` |
| **Problem it solved** | Typed, versionable state records attached to entities. |
| **North Star alignment** | Conceptually aligned with **Chronos v2 + interior state** as durable data — but schema must be re-derived for new Vi, not imported as dependency without review. |
| **Action** | `extract pattern only` — Zod-style single source of truth for state rows. |
| **Phase** | **Phase B** (design reference) → **Phase C** (full entity graph if needed). |

---

### 11. Memory strategy ADR

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/docs/90-adr/002-memory-strategy.md` |
| **Tag** | `reference only` |
| **Problem it solved** | Document why memory is split, how authority works, and what not to do. |
| **North Star alignment** | Supports **memory weighting** and governance; good guard against accidental “log everything” systems. |
| **Action** | `extract pattern only` — mine invariants; rewrite short ADR in new repo if still true. |
| **Phase** | **Phase A** (read + extract invariants) → **Phase B** when implementing weighting. |

---

### 12. Consolidation doc (memory lifecycle)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/core/vi/docs/30-memory/MB-Consolidation.md` |
| **Tag** | `reference only` |
| **Problem it solved** | Define consolidation lifecycle for memory blobs. |
| **North Star alignment** | Relevant to **memory weighting** and passive processing **if** consolidation is proven to change retrieval/behavior (Jarvis contract). |
| **Action** | `extract pattern only` — lifecycle stages, not file merge. |
| **Phase** | **Phase C/D**. |

---

### 13. Bounded embed queue (async work without “always-on cognition”)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/memory/src/lib/queue.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Offload embedding/indexing to a **bounded** worker with retries — avoid blocking chat path. |
| **North Star alignment** | Fits **bounded processing** and operational reality of memory weighting (index maintenance). |
| **Action** | `adapt structure` — same pattern may use different queue/DB; keep “job shape + retry + worker boundary.” |
| **Phase** | **Phase B** (if semantic memory on) → **Phase C** (scale). |

---

### 14. Embedder initialization + graceful degradation

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/memory/src/lib/embed.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Fail fast on embedder misconfig; fall back when keys/models missing. |
| **North Star alignment** | Supports honest failure behavior and observability — aligned with `06` / `08` “say what you know.” |
| **Action** | `extract pattern only` — health surface + explicit mode reporting; avoid silent fake vectors in production without labeling. |
| **Phase** | **Phase B** (when embeddings enter critical path). |

---

### 15. Qdrant collection + scoped vector search

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/memory/src/lib/qdrant.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Vector store lifecycle and filtered search by scope. |
| **North Star alignment** | Useful for **memory weighting** at scale; optional until semantic retrieval is a proven need (avoid premature cathedral). |
| **Action** | `adapt structure` — keep API shape ideas; infra choice may differ in new Vi. |
| **Phase** | **Phase C/D**. |

---

### 16. Observer pipeline (intent → plan → execute → reflect)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/brain/src/observer.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | End-to-end orchestration for Discord observations with resilience and privacy sanitization paths. |
| **North Star alignment** | Strong **decision graph** precedent — but size and Discord-specific concerns make it a **reference architecture**, not a transplant. Must not become “hidden autonomy” without state proof. |
| **Action** | `adapt structure` — extract staged pipeline + failure isolation; discard Discord-only policy unless re-specified. |
| **Phase** | **Phase C/D**. |

---

### 17. Discord brain reflector (persist structured reflection)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/brain/src/reflector.ts` |
| **Tag** | `adapt later` |
| **Problem it solved** | Persist execution summaries to memory API for later retrieval. |
| **North Star alignment** | Overlaps passive discovery artifacts — but coupling is HTTP + Discord scopes; must be rebased on **Vi Core** persistence and bounded artifacts (`07`). |
| **Action** | `adapt structure` — mirror “reflection payload + metadata” pattern; change storage and authority model. |
| **Phase** | **Phase C/D**. |

---

### 18. Pipeline evaluation heuristics

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/brain/src/evaluation.ts` |
| **Tag** | `reference only` |
| **Problem it solved** | Cheap offline-ish signals for success/failure/satisfaction from message shape. |
| **North Star alignment** | Useful for **tests and metrics**, dangerous if treated as **ground truth** for emotion or trust. |
| **Action** | `extract pattern only` — use in eval harnesses, not as interior state. |
| **Phase** | **Phase A** (eval only) → optional **Phase C**. |

---

### 19. Emotion enum + prompt injection

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/apps/brain/src/emotion.ts` |
| **Tag** | `reject` |
| **Problem it solved** | Bias system prompt by discrete “emotion” label. |
| **North Star alignment** | Conflicts with trimmed `08`: encourages **theater** and label-first interiority instead of **valence/intensity/drift** with causal hooks. |
| **Action** | `ignore` |
| **Phase** | `never` |

---

### 20. Prompt composer with emotion modifiers

| Field | Value |
|--------|--------|
| **Exact old repo path** | `vi-discord-bot/packages/prompts/src/composer.ts` |
| **Tag** | `reject` |
| **Problem it solved** | Token budgeting + tone modifiers + composed system prompt. |
| **North Star alignment** | Token budgeting idea is fine in isolation, but packaged with **emotion modifiers** and “autonomous assistant” framing — high risk of **persona injection** vs module sovereignty. |
| **Action** | `ignore` (rebuild budget selection without emotion table) |
| **Phase** | `never` (as a unit; **Phase A** only if dissecting token budget math as a separate pattern) |

---

### 21. Chat UI memory route (product surface)

| Field | Value |
|--------|--------|
| **Exact old repo path** | `Tentai Ecosystem/apps/chat-ui/app/api/memory/route.ts` |
| **Tag** | `reference only` |
| **Problem it solved** | Expose memory operations to UI for debugging or management. |
| **North Star alignment** | Observability-friendly; keep **operator** lane separate from lived chat per current UI direction. |
| **Action** | `extract pattern only` — “explicit API for memory ops” without coupling to old UI stack. |
| **Phase** | **Phase A** (if you want operator endpoints) → **Phase B**. |

---

### 22. LoreOS memory JSON + embeddings folder

| Field | Value |
|--------|--------|
| **Exact old repo path** | `LoreOS/memory/sessions/*.json`, `LoreOS/memory/embeddings/*.json` |
| **Tag** | `reject` (for core salvage) |
| **Problem it solved** | Lore-domain recall and narrative tooling. |
| **North Star alignment** | Not Vi sovereign core; risks importing **foreign ontology** into a system that must stay evidence-grounded for *self* and *user relationship* first. |
| **Action** | `ignore` for North Star execution (may remain creative reference elsewhere). |
| **Phase** | `never` |

---

### 23. ViBot command surface

| Field | Value |
|--------|--------|
| **Exact old repo path** | `ViBot/src/**/*.ts` (commands, music, XP, etc.) |
| **Tag** | `reject` |
| **Problem it solved** | Discord community features. |
| **North Star alignment** | orthogonal to causal core; useful only if you explicitly want **feature parity** later, not “alive core.” |
| **Action** | `ignore` |
| **Phase** | `never` (unless a future **Discord module** product scope is opened intentionally) |

---

## Execution priority (top 10, in order)

1. `Tentai Ecosystem/core/vi/src/clients/CLIENT_ADAPTER_RULES.ts` — sovereignty law  
2. `Tentai Ecosystem/core/vi/src/runtime/timeService.ts` — authoritative clock pattern  
3. `Tentai Ecosystem/core/vi/src/humanity/time/TimeEngine.ts` — engine boundary pattern  
4. `Tentai Ecosystem/core/vi/src/brain/memory/MemoryCurationPolicy.ts` — memory weighting / anti-noise  
5. `Tentai Ecosystem/core/vi/src/brain/grounding/MemoryResolver.ts` — grounded retrieval + citations  
6. `Tentai Ecosystem/core/vi/docs/90-adr/002-memory-strategy.md` — governance invariants  
7. `vi-discord-bot/apps/memory/src/lib/queue.ts` — bounded async processing  
8. `vi-discord-bot/apps/memory/src/lib/embed.ts` — embedder health / degradation discipline  
9. `Tentai Ecosystem/core/vi/src/runtime/conversationTurnSignals.ts` — decision gating (careful adapt)  
10. `Tentai Ecosystem/core/vi/src/brain/memory/MemoryOrchestrator.ts` — continuity pack shape (later slice)

---

## Explicit non-goals (from this map)

- Do **not** import `node_modules` or `.git` blobs from archives — treat archives as **read-only mines**, not dependencies.
- Do **not** resurrect reject-tier **emotion-as-prompt-injection** paths into new Vi Core.
- Do **not** expand scope into full old “observer/brain” unless a phase gate proves **state → behavior** causality first.

---

## Next step (after this doc)

When you approve implementation: pick **one Phase B vertical** (Chronos v2 state + one memory weighting hook + one test) and only then pull patterns from the `keep now` / early `adapt later` rows above.
