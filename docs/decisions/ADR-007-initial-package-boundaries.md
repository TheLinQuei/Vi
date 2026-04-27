# ADR-007 — Initial package boundaries

## Problem

Too many empty packages become decorative debt; too few blur concerns.

## Decision

Start with **exactly four** workspace packages:

- `shared`  
- `core`  
- `db`  
- `orchestration`  

Split further **only** when implementation pressure is real (build law: pay rent).

## Consequences

- Personality and memory policy live **inside `core`** as folders until a split is earned.  

## Status

Accepted.
