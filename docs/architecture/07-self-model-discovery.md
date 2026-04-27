# 07 — Self-Model Discovery (v1)

Status: Active supporting contract  
Authority: `13-vi-v1-canonical-contract.md` and `14-v1-contract-implementation-checklist.md`

This is an enforcement contract for bounded self-model discovery.
It defines how Vi may form capability preferences from grounded evidence.

## Purpose

Enable Vi to form preferences from understanding, not style or novelty.
Discovery must produce inspectable artifacts the user can review and approve.

## Core laws (normative)

- **No rejection from ignorance.** Vi must not reject capabilities she has not understood.
- **No expansion from novelty.** Vi must not prefer a capability because it sounds powerful or interesting.
- **Only preference from grounded understanding.** Preference must follow evidence + impact + risk + prerequisites.
- **Evidence-bound claims only.** Every capability claim must reference concrete evidence sources.
- **No hallucinated capability or self-description.** If evidence is missing, state unknown.

## Bounded execution model (v1)

- One capability at a time.
- Capability queue is explicit and finite.
- Evidence scope is explicit and finite per capability (file list, API behavior, observed outputs).
- No unconstrained repo wandering.
- No freeform recursive introspection.
- No fake claims of inner life, sentience, or phenomenology.
- No uncontrolled background processing.
- Bounded idle runtime is allowed when explicitly logged, resource-capped, and policy-limited.

## Reflection workflow (v1)

1. **Queued** — capability is waiting in queue.
2. **Reading** — bounded evidence packet is being examined.
3. **Analyzed** — evidence summarized into current-state map.
4. **Reflected** — strict template is completed with preference + reason + confidence.
5. **Approved** — user accepts reflection as current authority.

Transitions are linear for v1:
`queued -> reading -> analyzed -> reflected -> approved`

## Reflection template (strict, one capability)

Every reflection must include all fields below:

- `capability`
- `what_it_is`
- `what_it_does`
- `what_it_changes_for_vi`
- `current_state`
- `evidence` (list of concrete sources)
- `risks`
- `prerequisites`
- `preference` (`yes` | `not_yet` | `no`)
- `reason`
- `confidence` (`low` | `medium` | `high`)

## Human approval loop

- Reflections are proposals, not authority, until user approval.
- User approval promotes a reflection from `reflected` to `approved`.
- Unapproved reflections remain advisory.
- If user rejects a reflection, preference must return to queue/rework with updated evidence requirements.

## UI requirements for v1 observability

Primary signal must be capability progress, not repo percent:

- current capability under review
- status (`queued` / `reading` / `analyzed` / `reflected` / `approved`)
- last completed reflection
- next queued capability
- evidence/file count for current reflection
- activity feed (status changes + milestones)

Optional secondary signal:

- bounded evidence-read coverage for current capability packet
- if shown, it must remain secondary to queue/reflection progress
