# 02 — Runtime loop

Status: Active supporting spec  
Authority: `13-vi-v1-canonical-contract.md` and `14-v1-contract-implementation-checklist.md`

## HTTP ownership

- **Fastify** (`apps/api`) is the **only** public API host.  
- No second HTTP surface for agents or orchestration frameworks.  

## Streaming

**Single path:** provider / `packages/orchestration` produces **one** logical response stream → **Fastify** adapts and writes the HTTP stream → **web** consumes it. No parallel streaming stacks in Next server components beyond UI transport unless explicitly documented as the same byte stream end-to-end.

## LLM coordination boundary

- **All** LLM flow coordination (loading context, calling the model, assembling streams, invoking memory retrieval **orchestration**, applying core-provided shaping steps in sequence) lives in **`packages/orchestration`**.  
- **`apps/api`** handles: parse request, authenticate, resolve session/user, **call `orchestration.executeTurn` (or equivalent)**, forward stream to client, map errors to HTTP. **No** provider SDK usage, **no** turn assembly, **no** memory ranking logic in route modules beyond delegating to orchestration.

## Turn lifecycle (v0 target)

1. Message in (authenticated).  
2. Resolve user / session (transport layer + `db` via orchestration).  
3. Load recent messages (via `db` repositories).  
4. Retrieve ranked memories per **memory policy** (`core`) executed by **orchestration** using `db` (and optional external index if ever added).  
5. Build grounding packet (`core` rules; orchestration assembles inputs).  
6. Generate response (provider via orchestration).  
7. **Final voice / personality enforcement** (`core`): for v0, assume **post-hoc on full assistant text** unless a later ADR changes this (simpler than per-token shaping).  
8. Persist assistant message; persist **canonical** memory rows where policy approves; record **turn_events** (minimal).  
9. Emit any structured trace/event as needed (minimal v0).  

## Idle runtime loop (current v1.5 companion lane)

In addition to active chat turns, the API runs a bounded user-global idle tick:

1. Repo snapshot + fingerprint scan (bounded file set).
2. Changed-file digests persisted to user-global continuity state.
3. Safe read-only checks recorded in idle activity log.
4. Proposal queue updates for optional proactive pings and useful companion nudges.

Idle loop must remain bounded, inspectable, and non-editing.

Persistence calls go through **`db`** repositories; **`core`** never imports `db`.

## Orchestration framework decision (gate)

- **Default:** thin custom runner in `packages/orchestration`.  
- **Adopt** a third-party orchestration framework only if a **spike** satisfies the rules in `README.md` and ADR-002 (**4 hours wall clock**, **one owner**, **one written outcome**, **decision locked same day**).  

## Phase gates (usage-based)

Adding an **external memory index layer** or changing orchestration strategy follows **observed real usage** (see `README.md`). Hypothetical scale or “might need” is not sufficient.
