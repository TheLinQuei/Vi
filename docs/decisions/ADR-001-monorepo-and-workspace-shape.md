# ADR-001 — Monorepo and workspace shape

## Problem

Need clear package boundaries without excessive tooling overhead.

## Decision

Use **pnpm workspaces** and **Turbo**. Organize as `apps/*` and `packages/*` under the `vi` root.

## Consequences

- Shared types and enforced DAG are first-class.  
- CI can use Turbo caching once tasks exist.  

## Status

Accepted.
