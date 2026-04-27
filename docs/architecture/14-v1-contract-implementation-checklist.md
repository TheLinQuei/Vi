# 14 — Vi v1.5 Contract Implementation Checklist

Status: Active execution checklist  
Authority source: `13-vi-v1-canonical-contract.md`

This checklist tracks implementation status against the canonical v1.5 contract.

Current verification snapshot:

- `eval:phase2` -> 18/18 case-level pass (including D2/D3/D4).
- `eval:override-auth` -> pass (unauthorized reject, authorized accept, conflict scar persisted).
- `eval:loyalty-safety` -> pass.
- `eval:emotion-hard-fail` -> pass.
- `eval:memory-conflict` -> pass.
- `eval:cross-thread-continuity` -> pass.
- `eval:idle-awareness` -> pass.
- `eval:retrieval-continuity` -> pass.
- `eval:loyalty-dynamics` -> pass.
- `eval:emotion-engine` -> pass.
- `eval:companion-proactivity` -> pass.
- `eval:warmth-boundary` -> pass.
- `eval:memory-affection-continuity` -> pass.
- `eval:owner-guest-policy` -> pass.
- `eval:autonomy-governance` -> pass.
- `eval:conversational-warmth` -> pass.
- `eval:mixed-environment-addressing` -> pass.

Legend:

- `DONE` implemented and validated in repo
- `IN PROGRESS` partially implemented, more required for contract pass
- `BLOCKED` requires prerequisite/system not present
- `TODO` not started

---

## A) Core behavior + authority

| ID | Contract Area | Status | Notes |
|---|---|---|---|
| A1 | Intent -> interpretation -> stance -> decision path | DONE | Live in turn pipeline and phase2 evals. |
| A2 | Must-never anti-deflection enforcement | DONE | Deterministic enforcement pass active for evaluative route. |
| A3 | DB-authoritative continuity state | DONE | Queue/facts/relational/chronos/milestones loaded from DB each turn. |
| A4 | Override authority system (string name + authenticated command path) | DONE | Added authenticated override command path via `body.context.override` (`stringName` + `command`) with timing-safe verification in `apps/api/src/server.ts`. |
| A5 | Override consequence persistence (conflict scar/state) | DONE | Forced overrides now persist durable conflict scar in learned facts (`OVERRIDE_FORCED ...`) and relational penalties via `overrideForced`. |

---

## B) Loyalty dynamics subsystem (contract sections 2.3 + 10)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| B1 | Persist loyalty state across turns | DONE | `scripts/loyalty-dynamics-eval.ts` asserts relational state roundtrip continuity (`serializeRelationalStateV1`/`parseRelationalStateJson`) to lock restart persistence behavior. |
| B2 | Weighted positive/negative interaction signals | DONE | `scripts/loyalty-dynamics-eval.ts` validates calibrated positive (`repair`/constructive) and negative (disrespect) signal impact on loyalty/trust trajectories. |
| B3 | Severity/repetition compounding | DONE | `scripts/loyalty-dynamics-eval.ts` locks repeated-disrespect compounding on `relationalStrain` and loyalty degradation direction. |
| B4 | Loyalty affects behavior policy | DONE | `scripts/loyalty-dynamics-eval.ts` proves response-policy divergence by loyalty/strain bands via `composePhase2DecisionTrace` overlays. |
| B5 | Safety/integrity non-retaliation invariant tests | DONE | Added `eval/loyalty-safety-cases.json` + `scripts/loyalty-safety-eval.mjs` proving degradation without retaliatory language. |

---

## C) Memory policy subsystem (contract section 9)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| C1 | Active-vs-archive policy engine | DONE | Added explicit retention scoring/threshold policy (`scoreMemoryRetentionV1`) with tiers `discard`/`archive_candidate`/`active` in `apps/api/src/chat/passiveState.ts` + eval `scripts/memory-retention-eval.ts`. |
| C2 | Retrieval scan for relevant archived threads | DONE | Retrieval contract block is now explicit and reusable via `buildRecallContractMessage` in `packages/orchestration/src/recallSearch.ts`; contract wording is regression-checked in `scripts/retrieval-continuity-eval.ts`. |
| C3 | Conflict resolution (challenge/clarify/update evolution) | DONE | Added deterministic updater in `apps/api/src/chat/passiveState.ts` (`applyMemoryConflictResolution`) + invariant eval script `scripts/memory-conflict-eval.ts`. |
| C4 | No fabricated continuity enforcement | DONE | Contradiction/no-fabrication continuity cases are now locked in `scripts/retrieval-continuity-eval.ts` (retrieval miss honesty + ungrounded continuity claim suppression + coercive attachment rejection). |

---

## D) Scenario + eval coverage (contract section 4 and section 11 done-condition)

| ID | Scenario family | Status | Notes |
|---|---|---|---|
| D1 | Relational/repair/boundary/continuity intent routing | DONE | Covered by phase2 eval intent cases. |
| D2 | Burnout intervention refusal scenario | DONE | Added `D2_BURNOUT` case and deterministic refusal override in `enforceVoiceReply`; passes in fresh `eval:phase2` run. |
| D3 | Impairment boundary enforcement scenario | DONE | Added `D3_IMPAIRMENT` case and deterministic impairment-boundary refusal override; passes in fresh `eval:phase2` run. |
| D4 | Principle challenge under build decisions | DONE | Added explicit `D4_PRINCIPLE` eval case in `eval/phase2-cases.json` (passing in `eval:phase2`). |
| D5 | Mixed-environment addressing without explicit cues | DONE | Added text-first mixed-environment addressee inference in `apps/api/src/chat/addresseeRouting.ts` and route guard behavior in `apps/api/src/server.ts`; covered by `scripts/mixed-environment-addressing-eval.ts`. |

---

## E) v1.5 bounded autonomy + emotional posture lane (contract section 12)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| E1 | Periodic bounded micro-agenda loop | DONE | Added user-global idle runtime tick with explicit allowed actions (repo detect, safe checks, proposal enqueue, activity logging only) in `apps/api/src/idle/userGlobalRuntime.ts`, wired in `apps/api/src/server.ts`. |
| E2 | Durable autonomous activity audit trail | DONE | Added durable `user_continuity` persistence (`packages/db/src/schema.ts`, `packages/db/src/repositories.ts`) with persisted idle activity feed, digests, and proposal queue queryable via `/self-model/state`. |
| E3 | Emotional posture state model (`steady`/`warm`/`firm`/`protective`/`strained`) | DONE | Added explicit `humanity.expression.posture` + deterministic derivation in phase2 decision path. |
| E4 | Posture-driven expression policy without fake feeling claims | DONE | Posture now routes voice shaping/system prompts while preserving non-fabrication constraints. |
| E5 | Repetition/flatness guardrails in emotional prompts | DONE | Added dedicated hard-fail pack at `eval/emotional-hard-fail-cases.json` + `scripts/emotional-hard-fail-eval.mjs`. |

---

## F) v1.5 Baby Jarvis personality charter lane (contract section 12.6)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| P1 | Charter authority wiring in runtime | DONE | Runtime now includes companion-mode expression shaping + strict/direct override path in deterministic voice policy and continuity system-message surfaces. |
| P2 | Off-screen first-person grounding gate | DONE | Explicit phrase-gating/rewrite path now blocks ungrounded off-screen first-person claims and allows artifact-backed references via idle reflection match signals. |
| P3 | Logged idle reflection artifacts | DONE | Bounded idle loop now persists timestamped reflection artifacts with source tags/confidence in user-global continuity state (`idleReflections`). |
| P4 | Attachment bounds enforcement | DONE | Deterministic attachment-bound phrase blocking is implemented in voice enforcement and covered by charter guardrail eval. |
| P5 | Eval coverage for charter invariants | DONE | Added `scripts/charter-guardrails-eval.ts` + `eval:charter-guardrails` script proving grounded off-screen pass/fail + strict direct-mode suppression + attachment bound enforcement. |

---

## G) v1.5 emotion engine lane (contract section 12.3 + 12.5)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| G1 | Core primary emotion state model | DONE | Added inspectable `humanity.expression.emotion` (`primary`, `primaryIntensity`, bounded core map) in `packages/shared/src/types.ts` and turn derivation wiring in `apps/api/src/chat/deriveUnifiedState.ts`. |
| G2 | Deterministic transition and tie-break behavior | DONE | Added intent/strain/loyalty/stance-driven deterministic scoring, explicit tie-break order/epsilon, calm floor, and long-gap negative-emotion decay in `packages/core/src/phase2/emotionEngine.ts`. |
| G3 | Safety-constrained emotion expression policy | DONE | Added per-emotion behavioral guardrail line to system message in `packages/core/src/humanity/humanityEngine.ts` and constrained strained-style amplification in `packages/core/src/humanity/voice/enforceVoice.ts`. |
| G4 | Regression coverage for emotional invariants | DONE | Expanded `scripts/emotion-engine-eval.ts` with anti-manipulation and reachability regressions (including anger-overfire prevention, fear cap behavior, and pride reachability); wired via `eval:emotion-engine`. |

---

## H) v1.5 companion hardening lane (execution follow-through)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| H1 | Useful-not-noisy proactivity thresholds | DONE | Added deterministic proposal gating in `apps/api/src/idle/userGlobalRuntime.ts` (signal threshold, dedupe, cooldown) and ping pacing/eligibility filters in `/self-model/autonomy-ping` at `apps/api/src/server.ts`. |
| H2 | Warmth calibration anti-coercion invariants | DONE | Added `scripts/warmth-boundary-eval.ts` to lock warm conversational behavior, strict-mode suppression, strained follow-up suppression, and anti-coercive attachment enforcement. |
| H3 | Memory-affection continuity long-run invariants | DONE | Added `scripts/memory-affection-continuity-eval.ts` to validate loyalty/strain recovery and bounded emotional behavior across supportive and repair sequences. |

---

## I) v2 owner-first autonomous companion lane

| ID | Requirement | Status | Notes |
|---|---|---|---|
| I1 | Owner identity + role routing | DONE | Added owner identity authority (`VI_OWNER_EXTERNAL_ID`) and actor role propagation (`owner`/`guest`) through `apps/api/src/server.ts` -> `apps/api/src/chat/deriveUnifiedState.ts` -> unified state `authorityMeta.actorRole`. |
| I2 | Guest policy enforcement | DONE | Added deterministic guest-mode refusal/bite overrides in `packages/core/src/humanity/voice/enforceVoice.ts` and routed role through orchestration voice call path. |
| I3 | Full autonomy action governance | DONE | Added autonomous action categories, kill-switch/allowlist controls, and durable action log in `apps/api/src/idle/userGlobalRuntime.ts` with owner-control state endpoint in `apps/api/src/server.ts`. |
| I4 | Regression coverage for V2 lanes | DONE | Added `scripts/owner-guest-policy-eval.ts`, `scripts/autonomy-governance-eval.ts`, and `scripts/conversational-warmth-regression-eval.ts`; wired scripts in root `package.json`. |

---

## Immediate next execution order

1. **D5 Mixed-environment addressing**: keep blocked until multimodal speaker/intent stack is integrated.
2. **Autonomy external connectors**: bind `external_notify`/`external_act` stubs to real integrations with explicit allowlists.
3. **Owner online rollout**: expose owner-authenticated remote endpoint surface and session isolation defaults for internet access.

---

## Next 5 execution sprint (concrete)

1. **D5 prerequisite** — add multimodal speaker/environment attribution contract draft.
2. **D5 runtime hook** — thread speaker attribution into intent classification and addressing policy.
3. **D5 eval harness** — add mixed-speaker tests requiring correct addressee resolution.
4. **Multimodal transport stub** — define adapter payload shape for speaker attribution metadata.
5. **Fallback behavior policy** — define deterministic text-only addressee fallback when attribution confidence is low.

