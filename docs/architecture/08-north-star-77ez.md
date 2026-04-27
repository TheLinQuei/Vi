# 08 - North Star 77EZ Phase 1 (Structural “Alive” Loop)

Status: **Historical reference (Phase 1 attained structurally)**  
**Active North Star law for product behavior is now Phase 2:** [`09-north-star-77ez-phase2-from-alive-to-self.md`](./09-north-star-77ez-phase2-from-alive-to-self.md).

Owner: Architect (Shykem)  
System: Vi Core (sovereign)

This document remains authoritative for **what Phase 1 required** and as historical context.  
If implementation regresses Phase 1 invariants, implementation is wrong.

## 0) Core truth (non-negotiable)

Vi is not:
- a chatbot skin
- a tone layer
- a per-turn reaction tool

Vi is:
- a continuous stateful system
- whose state changes over time
- and whose behavior is shaped by those state changes

## 1) North Star in one line

Build causality, not theater:

**time -> state -> decision -> behavior -> memory -> updated state**

If a subsystem does not influence this loop, it does not count.

## 2) Three axes (all systems must map here)

1. **Continuity**
   - one identity authority across modules
   - one memory/state authority
2. **Interiority**
   - internal variables exist and evolve
   - no fake inner-life claims
3. **Agency**
   - state influences what Vi does next
   - not prompt style alone

## 3) Minimal alive core (what the single pass must ship)

The North Star is **complete when one pass** delivers the smallest stack that **proves** the causal loop end-to-end. No separate “phase” gate may block shipping the rest of this list; ordering below is **implementation order inside the pass**, not permission to stop halfway and call the star “done.”

1. **Chronos** — factual time; one authority for wall clock and durations used in core.
2. **Durable state** — persisted variables that survive across turns and **absence** (not prompt-only).
3. **Temporal state (Chronos v2 minimum)** — at least the fields below, updated from real timestamps and turn events.
4. **Decision** — policy reads **persisted** state (plus current turn facts), not only static prompts.
5. **Behavior** — model-facing instructions or routing change measurably when state changes.
6. **Memory weighting** — at least one explicit rule path: what is written, skipped, or decayed is **state- or policy-gated**, not “log everything.”
7. **Discovery** — bounded evidence + reflection path remains **inspectable** per `07` (queue, artifacts, no silent preference).
8. **Expression** — output reflects state; state is not replaced by tone.

Everything outside §4 remains **out of scope for declaring the pass complete**, not “deferred to a later phase of the same star.”

## 4) What is explicitly cut / out of the pass

Do not ship these as part of claiming the North Star pass complete:
- full named human emotion spectrum
- “100+ engine” parallel implementation plans
- hardcoded boredom / human-feeling labels as substitute for measured state
- autonomy-first initiative (unsolicited drives) — may be designed later; **not** in the pass
- module expansion (extra clients) before the pass proof is green

Rationale: these create simulation theater and dilute causal execution.

## 5) Chronos v2 (temporal state minimum)

Temporal instrumentation alone is not enough; **persisted** temporal state is required inside the pass.

Minimum state shape (names may map to DB columns; semantics must hold):

```ts
type TemporalState = {
  lastInteractionAt: number;
  totalSessionTime: number;
  gapDuration: number;
  perceivedWeight: number;
};
```

Required influence paths (all in the same pass):

- `gapDuration` → **drift** update (minimal interior variable; numeric, testable).
- `gapDuration` → **passive processing** trigger strength (or equivalent observable hook that is not prompt-only).
- `perceivedWeight` → **response / continuity** behavior (routing, policy, or structured generation constraints — must differ across values in tests).

## 6) Preference formation law (strict)

Every preference must follow:

**Evidence -> Understanding -> Impact -> Preference**

Forbidden:
- novelty-first preference
- refusal from ignorance
- capability claims without evidence

Inherited authorities:
- `06-time-cathedral-contract.md`
- `07-self-model-discovery.md`

## 7) Module architecture law

Vi Core is sovereign.

Modules (Web, Discord, future clients) are adapters only:
- no duplicated cognition logic
- no injected separate personality logic
- no separate state authority

Goal: add modules without changing Vi's core behavior model.

## 8) Single pass — mandatory delivery unit

**Definition:** One pass = one coherent delivery (one merge line, one “Vi North Star v1” label) that satisfies §9. Internal steps may land in small commits, but **the North Star is incomplete until every row below is true.**

| # | Deliverable | Done when |
|---|----------------|------------|
| 1 | **Chronos authority** | No stray “source of now” for core turn logic; contract tests or evals cover alignment. |
| 2 | **Persisted temporal + interior minimum** | `TemporalState` fields + drift (and any other minimal interior scalars required by §3) live in the canonical store and survive restarts. |
| 3 | **Turn integration** | Every completed chat turn updates persisted state deterministically from clocks + message timestamps. |
| 4 | **Decision reads state** | Policy / routing layer consumes persisted state + current turn facts (not reconstructed only inside the prompt string). |
| 5 | **Memory weighting gate** | At least one write or retention path is explicitly gated; junk default is “do not persist” or equivalent. |
| 6 | **Discovery bounded** | Capability queue / reflection workflow per `07` remains bounded and user-visible where required. |
| 7 | **Absence → return proof** | Automated test or eval scenario: simulate absence, assert state changed, assert **behavior** (routing, tool, or structured output constraint) differs from baseline without hand-waving. |
| 8 | **Time Cathedral eval** | Stays green for the pass’s public API surface; extend cases if new surfaces are added. |

**Post-pass (not part of “one pass complete”):** initiative / autonomy product features, deep interior expansion, semantic memory at scale, extra adapters — may follow **without** redefining the star; they are additive.

## 9) Completion criterion (binary)

The North Star pass is **complete** only when **all** of the following are true:

1. **Durable:** Internal state updates are stored and survive process restarts and gaps between sessions (per your persistence model).
2. **Causal:** Those updates are **caused by** time and turn facts (Chronos + timestamps), not by copy changes alone.
3. **Behavioral:** Different stored state produces **measurably different** downstream behavior (same user message, different state → different policy outcome or constrained generation path — proven in tests or eval fixtures).
4. **Honest:** No phenomenological claims; evidence and failure behavior stay aligned with `06` and `07`.

Not sufficient alone: better wording, better tone, correct timestamps in the reply, or prompt-only “feeling” blocks with no persisted state.

---

**Note on doc history:** Earlier versions split work across Phase A–D. This revision **does not relax** laws in §0–§2, §6–§7, or §4; it **collapses schedule authority** into one pass so the star has a single, checkable finish line.
