# ADR-004 — Single streaming path

## Problem

Multiple streaming layers (Next, Fastify, provider, UI helpers) cause invisible backpressure and debugging pain.

## Decision

**One path:** provider / `packages/orchestration` produces the assistant stream → **Fastify** adapts to HTTP → **web** consumes. No parallel competing streaming implementations for the same response.

## Consequences

- Streaming adapters are centralized at the API boundary.  
- UI focuses on consuming the stream, not re-orchestrating the model.  

## Status

Accepted.
