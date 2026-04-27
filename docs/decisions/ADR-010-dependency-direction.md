# ADR-010 — Workspace dependency direction

## Problem

Undocumented import direction leads to circular dependencies and accidental core pollution.

## Decision

Enforce this **acyclic** graph:

| Node | Imports |
|------|---------|
| `shared` | — |
| `db` | `shared` |
| `core` | `shared` |
| `orchestration` | `core`, `shared`, `db` |
| `apps/api` | `orchestration`, `db`, `shared` |
| `apps/web` | `shared` |

**Hard bans**

- `core` → not `db`, not `orchestration`  
- `db` → not `core`  
- `shared` → not other workspace packages  

**LLM coordination** lives only in `orchestration`; `apps/api` stays transport + auth/session + delegation + stream delivery (root `README.md`, `02-runtime-loop.md`).

## Consequences

- Lint or CI dependency rules should enforce this when code exists.  

## Status

Accepted.
