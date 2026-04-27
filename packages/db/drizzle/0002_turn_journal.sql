CREATE TABLE IF NOT EXISTS turn_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  user_message_id UUID,
  assistant_message_id UUID,
  wall_now_utc_iso TEXT NOT NULL,
  wall_now_epoch_ms BIGINT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
