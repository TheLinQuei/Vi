ALTER TABLE turn_journal
  ALTER COLUMN wall_now_epoch_ms TYPE BIGINT USING wall_now_epoch_ms::bigint;
