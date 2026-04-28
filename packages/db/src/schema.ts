import { bigint, integer, pgTable, real, text, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalId: text("external_id").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authIdentities = pgTable("auth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerUserId: text("provider_user_id").notNull(),
  email: text("email"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webSessions = pgTable("web_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionTokenHash: text("session_token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  rollingSummary: text("rolling_summary"),
  summaryMessageCount: integer("summary_message_count").notNull().default(0),
  lastInteractionEpochMs: bigint("last_interaction_epoch_ms", { mode: "number" }),
  totalSessionWallMs: bigint("total_session_wall_ms", { mode: "number" }).notNull().default(0),
  lastGapDurationMs: bigint("last_gap_duration_ms", { mode: "number" }).notNull().default(0),
  perceivedWeight: real("perceived_weight").notNull().default(0),
  drift: real("drift").notNull().default(0),
  passiveProcessingStrength: real("passive_processing_strength").notNull().default(0),
  discoveryQueueJson: text("discovery_queue_json"),
  learnedFactsJson: text("learned_facts_json"),
  relationalStateJson: text("relational_state_json"),
  capabilityMilestonesJson: text("capability_milestones_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system">().notNull(),
  content: text("content").notNull(),
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userContinuity = pgTable("user_continuity", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  globalStateJson: text("global_state_json"),
  idleActivityJson: text("idle_activity_json"),
  repoDigestsJson: text("repo_digests_json"),
  proposalQueueJson: text("proposal_queue_json"),
  lastRepoScanAt: timestamp("last_repo_scan_at", { withTimezone: true }),
  lastRepoFingerprint: text("last_repo_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userXp = pgTable(
  "user_xp",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    xp: integer("xp").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: bigint("last_message_at", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

export const turnJournal = pgTable("turn_journal", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  status: text("status").notNull(),
  userMessageId: uuid("user_message_id"),
  assistantMessageId: uuid("assistant_message_id"),
  wallNowUtcIso: text("wall_now_utc_iso").notNull(),
  wallNowEpochMs: bigint("wall_now_epoch_ms", { mode: "number" }).notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
