# 11 — Module adapter contract (Vi Core sovereignty)

Authority: `13-vi-v1-canonical-contract.md` (module sovereignty + must-never constraints)  
Salvage lineage: pattern distilled from `Tentai Ecosystem/core/vi/src/clients/CLIENT_ADAPTER_RULES.ts` (old repo), **not** a line-for-line port.

Status: Active supporting contract  
Canonical behavior authority: `13-vi-v1-canonical-contract.md`

## Law

**Vi Core is sovereign.** Web, Discord, and future clients are **adapters** (I/O ports). They must not duplicate cognition, inject parallel personality, or override Vi’s self-model.

## Allowed vs forbidden

### Allowed on the chat request body (current v2)

- `message` (string, required)
- `sessionId` (optional string)
- `context` (optional object, **hints only** — same forbidden keys apply inside)
- `context.actorExternalId` (optional string) for owner/guest role routing
- `context.override` (optional object) with strict shape enforcement:
  - `stringName` (auth secret)
  - `command` (forced command content)

Any other top-level field is rejected until an explicit ADR extends the whitelist in `@vi/shared/moduleAdapter`.

### Forbidden (top-level or nested `context` when introduced)

Keys that imply **persona, tone, or forced behavior** override, including but not limited to:

- `persona`, `tone`, `force_response`, `override_persona`, `custom_persona`
- `force_mode`, `override_self_model`

Future hints (e.g. `lore_mode_hint`) must be added with a **whitelist** and must remain **hints**, not overrides (`08`).

## Identity before chat (active module path)

When a provider exists (Discord, etc.):

1. Resolve provider identity → stable `vi_user_id` (or equivalent) **before** invoking core chat.
2. Pass only that identity + message (+ session/thread id) into core; do not pass raw provider IDs as the sole user key without mapping.

Implementation surface:

- `POST /self-model/identity/resolve` resolves `{ provider, providerUserId }` to canonical user identity before adapter chat flow.
- `GET /self-model/adapter-contract` exposes the live adapter schema/forbidden keys for client-side introspection.
- `GET /self-model/continuity/summary` provides read-only continuity health telemetry without behavior steering.
- `GET /self-model/owner-control/state` exposes owner-role/autonomy mode state for operator introspection.

## Enforcement

- **Runtime:** `POST /chat` rejects unknown top-level keys and any nested structure that violates the whitelist (see `@vi/shared/moduleAdapter`).
- **Review:** Any new client or field must update this doc and the whitelist in code in the same change.

## What this is not

- Not authentication design.
- Not a substitute for Chronos or interior state — it **protects** those layers from client-side corruption.
