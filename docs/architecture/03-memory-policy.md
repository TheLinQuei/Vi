# 03 — Memory policy

Status: Active supporting spec  
Authority: `13-vi-v1-canonical-contract.md` section 9, execution status in `14-v1-contract-implementation-checklist.md`

## Canonical authority

- **Postgres** is the **canonical** store for memories (and all durable chat/session data per data model).  
- If an **external memory index layer** exists, it is **retrieval/index support only**, not source of truth.  

## v0 retrieval

- Start with **Postgres-backed** memory rows plus **policy and ranking** in **`packages/core`** (rules) executed by **`packages/orchestration`** (I/O).  
- **No external memory index layer on day one** unless a phase gate has already fired under **observed real usage** (see below).

## Writes

1. **Canonical write** to Postgres first (insert/update/delete as designed).  
2. **Index update** (if an external layer exists) **after** canonical success.  
3. On conflict between index and Postgres: **Postgres wins**; repair or rebuild the index from Postgres.  

## Index failure

Index degradation or retrieval failure **does not** imply memory loss if Postgres is intact. Degraded mode: fall back to Postgres-only retrieval until the index is repaired.

## Rebuild / backfill

If an external memory index layer is adopted: the index **must be rebuildable entirely** from canonical Postgres records (e.g. embedding or config change, empty index, corruption). Document the operational command or job in implementation; principle is fixed here.

## What becomes memory (v0)

Define explicitly in implementation, guided by:

- **Eligible:** stable preferences, explicit user-stated facts, relationship/identity notes that policy allows, style anchors that are not toxic or redundant.  
- **Never:** secrets the user asked not to store, illegal content, transient noise, raw chain-of-thought, other users’ private data.  

## Current v1 memory tiers

Memory retention is scored and tiered:

- `discard`
- `archive_candidate`
- `active`

Conflict-update records must not be silently discarded when continuity conflict handling is active.

## Phase gate — external memory index layer

Add **only** when **observed real usage** shows at least one of:

- Recall quality is **clearly insufficient** with Postgres-only retrieval under the shipped policy.  
- SQL-based ranking/retrieval is **meaningfully** messy or slow **in practice** for real sessions.  
- **Semantic** retrieval is **necessary** often enough to justify ops and dependency cost—not “might be nice.”  

Hypothetical future scale does **not** trigger the gate.
