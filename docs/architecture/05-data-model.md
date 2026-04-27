# 05 — Data model (live)

Status: Active supporting spec  
Authority: `packages/db/src/schema.ts` (canonical schema), `13-vi-v1-canonical-contract.md` (behavior constraints)

This document mirrors the current live Drizzle schema in `packages/db/src/schema.ts`.

## `users`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `uuid` | PK, default random |
| `external_id` | `text` | required, unique |
| `display_name` | `text` | optional |
| `created_at` | `timestamptz` | required, default now |
| `updated_at` | `timestamptz` | required, default now |

## `sessions`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `uuid` | PK, default random |
| `user_id` | `uuid` | required, FK -> `users.id`, cascade delete |
| `title` | `text` | optional |
| `rolling_summary` | `text` | optional |
| `summary_message_count` | `integer` | required, default `0` |
| `last_interaction_epoch_ms` | `bigint(number)` | optional |
| `total_session_wall_ms` | `bigint(number)` | required, default `0` |
| `last_gap_duration_ms` | `bigint(number)` | required, default `0` |
| `perceived_weight` | `real` | required, default `0` |
| `drift` | `real` | required, default `0` |
| `passive_processing_strength` | `real` | required, default `0` |
| `discovery_queue_json` | `text` | optional |
| `learned_facts_json` | `text` | optional |
| `relational_state_json` | `text` | optional |
| `capability_milestones_json` | `text` | optional |
| `created_at` | `timestamptz` | required, default now |
| `updated_at` | `timestamptz` | required, default now |

## `messages`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `uuid` | PK, default random |
| `session_id` | `uuid` | required, FK -> `sessions.id`, cascade delete |
| `role` | `text` | required, typed as `user | assistant | system` |
| `content` | `text` | required |
| `model` | `text` | optional |
| `tokens_in` | `integer` | optional |
| `tokens_out` | `integer` | optional |
| `created_at` | `timestamptz` | required, default now |

## `user_continuity`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `uuid` | PK, default random |
| `user_id` | `uuid` | required, unique, FK -> `users.id`, cascade delete |
| `global_state_json` | `text` | optional |
| `idle_activity_json` | `text` | optional |
| `repo_digests_json` | `text` | optional |
| `proposal_queue_json` | `text` | optional |
| `last_repo_scan_at` | `timestamptz` | optional |
| `last_repo_fingerprint` | `text` | optional |
| `created_at` | `timestamptz` | required, default now |
| `updated_at` | `timestamptz` | required, default now |

## `turn_journal`

| Column | Type | Constraints / Notes |
|---|---|---|
| `id` | `uuid` | PK, default random |
| `session_id` | `uuid` | required, FK -> `sessions.id`, cascade delete |
| `phase` | `text` | required |
| `status` | `text` | required |
| `user_message_id` | `uuid` | optional |
| `assistant_message_id` | `uuid` | optional |
| `wall_now_utc_iso` | `text` | required |
| `wall_now_epoch_ms` | `bigint(number)` | required |
| `error_message` | `text` | optional |
| `created_at` | `timestamptz` | required, default now |
| `updated_at` | `timestamptz` | required, default now |

## Notes

- The schema above is the authority for table/column naming.
- Behavioral constraints (no-fabrication, continuity, bounded idle runtime) are defined in `13-vi-v1-canonical-contract.md`.
