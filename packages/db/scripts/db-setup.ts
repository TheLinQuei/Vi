import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");
const migrationFiles = [
  "0000_step4_init.sql",
  "0001_session_rolling_summary.sql",
  "0002_turn_journal.sql",
  "0003_turn_journal_epoch_bigint.sql",
  "0004_session_north_star.sql",
  "0005_session_relational_state.sql",
  "0006_session_capability_milestones.sql",
  "0007_user_continuity.sql",
  "0008_user_xp.sql",
  "0009_auth_tables.sql",
];

const pool = new Pool({ connectionString });

try {
  for (const name of migrationFiles) {
    const sqlPath = join(drizzleDir, name);
    const sql = await readFile(sqlPath, "utf8");
    await pool.query(sql);
  }
  console.log("Database schema is ready.");
} finally {
  await pool.end();
}
