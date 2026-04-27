CREATE TABLE IF NOT EXISTS "user_continuity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "global_state_json" text,
  "idle_activity_json" text,
  "repo_digests_json" text,
  "proposal_queue_json" text,
  "last_repo_scan_at" timestamptz,
  "last_repo_fingerprint" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
