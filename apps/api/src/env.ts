import { z } from "zod";

const ApiEnvSchema = z.object({
  API_PORT: z.coerce.number().default(3001),
  VI_OWNER_EXTERNAL_ID: z.string().default("owner:you"),
  VI_CORS_ORIGINS: z.string().default(""),
  VI_DEBUG_CONTEXT: z.enum(["true", "false"]).default("false"),
  VI_USER_TIMEZONE: z.string().optional(),
  VI_PASSIVE_DISCOVERY_GAP_MINUTES: z.coerce.number().default(30),
  VI_TEMPORAL_MEANINGFUL_GAP_MS: z.string().optional(),
  VI_DEBUG_DECISION_TRACE: z.enum(["true", "false"]).default("true"),
  VI_IDLE_WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  VI_IDLE_SCAN_INTERVAL_MS: z.coerce.number().default(300000),
  VI_IDLE_ACTIVE_WINDOW_HOURS: z.coerce.number().default(24),
  VI_OVERRIDE_STRING_NAME: z.string().default(""),
  VI_AUTONOMY_PING_MIN_INTERVAL_MS: z.coerce.number().default(600000),
  VI_AUTONOMY_MIN_RELEVANCE: z.enum(["low", "medium", "high"]).default("medium"),
  VI_REQUIRE_API_KEY: z.enum(["true", "false"]).default("false"),
  VI_PUBLIC_API_KEY: z.string().default(""),
  VI_OWNER_API_KEY: z.string().default(""),
  // Empty means "no owner email gate"; must not use `.email().default("")` (invalid email fails parse).
  VI_OWNER_EMAIL: z.union([z.string().email(), z.literal("")]).default(""),
  VI_SESSION_COOKIE_NAME: z.string().default("vi_session"),
  VI_SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(720),
  VI_SESSION_SECURE: z.enum(["true", "false"]).default("true"),
  VI_GOOGLE_CLIENT_ID: z.string().default(""),
  VI_GOOGLE_CLIENT_SECRET: z.string().default(""),
  VI_GOOGLE_REDIRECT_URI: z.string().default(""),
  VI_GUEST_MESSAGE_LIMIT: z.coerce.number().int().min(0).default(8),
  VI_AUTONOMY_ENABLED: z.enum(["true", "false"]).default("true"),
  VI_AUTONOMY_ALLOW_LOCAL_READ: z.enum(["true", "false"]).default("true"),
  VI_AUTONOMY_ALLOW_LOCAL_WRITE_SAFE: z.enum(["true", "false"]).default("true"),
  VI_AUTONOMY_ALLOW_EXTERNAL_NOTIFY: z.enum(["true", "false"]).default("true"),
  VI_AUTONOMY_ALLOW_EXTERNAL_ACT: z.enum(["true", "false"]).default("true"),
  VI_RUNTIME_PROFILE: z.enum(["balanced", "smart_core"]).default("balanced"),
  VI_ALLOW_PROACTIVE_PINGS: z.enum(["true", "false"]).default("true"),
  VI_INCLUDE_PASSIVE_PENDING_MENTION: z.enum(["true", "false"]).default("true"),
  /** Allow guest-tier `/chat` to use OSS lane when `context.vi.preferOpenWeights` is set (owner always allowed). */
  VI_OSS_ALLOW_GUEST: z.enum(["true", "false"]).default("false"),
  /** Optional webhook for media tool envelopes (`media.generate_image` / `media.generate_video`). */
  VI_MEDIA_TOOL_WEBHOOK_URL: z.string().optional(),
  VI_MEDIA_TOOL_WEBHOOK_SECRET: z.string().optional(),
  /** Optional webhook for search tool envelopes (`web.search` / `docs.search`). */
  VI_SEARCH_TOOL_WEBHOOK_URL: z.string().optional(),
  VI_SEARCH_TOOL_WEBHOOK_SECRET: z.string().optional(),
  DATABASE_URL: z.string().min(1),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;
export const apiEnv = ApiEnvSchema.parse(process.env);
