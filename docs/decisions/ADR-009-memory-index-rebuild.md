# ADR-009 — Canonical write order and index rebuild

## Problem

If an external memory index layer exists, skew between index and database corrupts retrieval trust.

## Decision

1. **Write canonical** memory rows to Postgres **first**.  
2. **Update the external memory index layer** only after canonical success.  
3. If the index is empty, stale, corrupted, or embedding configuration changes, **rebuild from Postgres**.  
4. Index retrieval failure means **degraded retrieval**, not data loss, when Postgres is healthy.  

## Consequences

- Requires a documented rebuild path when an index layer ships.  

## Status

Accepted.

## Note

If v0 never adds an index layer, this ADR still governs any future adoption.
