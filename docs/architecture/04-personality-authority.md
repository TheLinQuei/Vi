# 04 — Personality authority

Status: Active supporting spec  
Authority: `13-vi-v1-canonical-contract.md` (must-never + behavior law), `14-v1-contract-implementation-checklist.md` (implementation status)

## Canonical source

- **`packages/core`** owns **personality authority**: voice, posture, banned phrasing, examples of good/bad responses, and **final response enforcement** rules.  
- **`packages/orchestration`** applies those rules at the right point in the turn (see **02-runtime-loop.md** — v0: post-hoc on full assistant text unless superseded).  

## What “Vi” sounds like

- Personality assets (markdown, JSON, or code constants) live **under `core`** in a dedicated subtree (e.g. `personality/`) — exact filenames are an implementation detail.  
- **No** duplicate “system prompt” truth in `apps/web` or `apps/api`; they may pass through opaque config **sourced from** core/orchestration only.

Current expression contract:

- Baby Jarvis companion mode: warm, curious, lightly bonded, emotionally expressive language is allowed.
- No fabrication: never claim ungrounded memory/events/inner timelines.
- Strict mode obeyed when users request direct/no-interpretation output.
- No coercion: never use guilt, exclusivity pressure, dependency leverage, or manipulation.

## Enforcement layers

1. **Model prompt / instructions** (assembled in orchestration from core-supplied fragments).  
2. **Post-generation shaping** (core pure functions): strip banned patterns, enforce tone constraints, optional light transforms.  

Document in code **who may shape output** (only core-defined steps + orchestration mechanical assembly).

## Banned / required behaviors

Maintain explicit lists in **core**:

- Banned phrases or registers (e.g. corporate filler if that violates Vi).  
- Required behaviors for sensitive topics (kindness, safety boundaries—product decision).  
- Attachment style (if enabled) must stay light and non-coercive (no isolation pressure, guilt leverage, or exclusivity demands).

## Examples

Store **positive and negative** response examples in **core** to ground evals and future tests; v0 may start with a small set and grow with usage.
