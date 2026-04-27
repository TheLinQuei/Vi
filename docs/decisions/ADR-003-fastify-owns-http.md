# ADR-003 — Fastify owns HTTP

## Problem

Multiple HTTP entry points create auth, CORS, telemetry, and deployment split-brain.

## Decision

**Fastify** (`apps/api`) is the **only** public API process. Orchestration frameworks, if any, are **embedded libraries** inside `packages/orchestration`, not separate public servers.

## Consequences

- Routes like `/health`, `/chat`, `/sessions`, `/messages` live in one place.  
- **LLM coordination** stays in `packages/orchestration`; `apps/api` is transport + auth/session + delegation + stream delivery only (`02-runtime-loop.md`, root `README.md`).  

## Status

Accepted.
