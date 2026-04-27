# ADR-002 — Runtime stack and orchestration default

## Problem

Choose a v0 stack that is modern, maintainable, and aligned with the build law in `README.md`.

## Decision

**v0 stack**

- **Web:** Next.js (App Router, TypeScript)  
- **API:** Fastify (TypeScript) — sole public HTTP host (see ADR-003)  
- **Persistence:** Postgres + Drizzle  
- **Local LLM:** Ollama with **one pinned model** (ADR-008)  

**Orchestration**

- **Default:** a **thin custom turn runner** in `packages/orchestration`.  
- A third-party orchestration framework is **not** assumed. Adoption requires a **spike** that proves **less owned code**, **acceptable dependency weight**, and **no violation of core boundaries** — **4 hours wall clock**, **one owner**, **one written outcome**, **decision locked the same day** (see root `README.md`).  

**Memory index**

- **No external memory index layer** at start; Postgres + policy only until a **usage-based** phase gate fires (ADR-005, `03-memory-policy.md`).

## Consequences

- Framework choices remain replaceable behind `orchestration` and ports in `core`.  
- Spike discipline prevents multi-day tool drift.  

## Status

Accepted.
