# ADR-005 — Memory authority and optional index layer

## Problem

Dual writes or dual sources of truth for memory cause inconsistency and operational failure.

## Decision

1. **Postgres** is the **canonical** memory store (`memories` table and related entities).  
2. **v0** uses **Postgres + policy + ranking** only until **observed real usage** justifies more (see `03-memory-policy.md` phase gate — not hypothetical scale).  
3. An **external memory index layer** (vendor-agnostic; semantic/vector retrieval helper) is **optional**. If added: index entries reference canonical Postgres memory ids; on disagreement, **Postgres wins**; index is **rebuildable** from Postgres (ADR-009).  
4. **Canonical write first**, index update **after** successful persistence.  

## Consequences

- Retrieval can start simple and evolve without rewriting canon.  
- Ops must plan rebuild jobs if an index layer is adopted.  

## Status

Accepted.
