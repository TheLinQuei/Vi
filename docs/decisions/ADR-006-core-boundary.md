# ADR-006 — Core package boundary

## Problem

Framework and persistence coupling in domain logic makes Vi hard to test and expensive to change.

## Decision

`packages/core` is **framework-agnostic** and **persistence-agnostic**.

- **May import:** `shared` only.  
- **Must not import:** `db`, `orchestration`, `apps/*`, Fastify, Next.js, agent/orchestration frameworks, or LLM provider SDKs.  

**Contains:** turn contracts, identity rules, memory **policy**, grounding rules, personality authority, response shaping (pure functions), **ports** (interfaces) for persistence and providers.

**Does not contain:** Drizzle/SQL, HTTP, or LLM transport.

## Consequences

- `orchestration` and `db` implement ports and glue.  
- Slightly more wiring; clearer seams (see `01-repo-shape.md`).  

## Status

Accepted.
