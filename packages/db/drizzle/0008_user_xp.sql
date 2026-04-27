CREATE TABLE IF NOT EXISTS user_xp (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at BIGINT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_xp_guild_xp_idx ON user_xp (guild_id, xp DESC);
