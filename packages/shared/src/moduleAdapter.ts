/**
 * Module adapter contract — runtime enforcement for Vi Core sovereignty (`08`, doc `11-module-adapter-contract.md`).
 * Pattern only: no client persona/tone/override keys at the API boundary.
 */

/** Optional `context` may carry hints later; must never carry override keys. */
const ALLOWED_TOP_LEVEL_KEYS = new Set(["message", "sessionId", "context"]);

/** Keys that must never appear as behavior overrides from adapters (old CLIENT_ADAPTER_RULES spirit). */
export const FORBIDDEN_ADAPTER_KEYS = [
  "persona",
  "tone",
  "force_response",
  "override_persona",
  "custom_persona",
  "force_mode",
  "override_self_model",
] as const;

function violationsForForbiddenKeys(obj: Record<string, unknown>, path: string): string[] {
  const out: string[] = [];
  for (const key of FORBIDDEN_ADAPTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      out.push(`${path}.${key} is forbidden (module adapter contract)`);
    }
  }
  return out;
}

function validateOverrideContext(ctx: Record<string, unknown>): string[] {
  const out: string[] = [];
  const maybeOverride = ctx.override;
  if (maybeOverride === undefined) return out;
  if (maybeOverride === null || typeof maybeOverride !== "object" || Array.isArray(maybeOverride)) {
    out.push("body.context.override must be an object when present");
    return out;
  }
  const o = maybeOverride as Record<string, unknown>;
  const allowed = new Set(["stringName", "command"]);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) out.push(`body.context.override.${k} is not allowed`);
  }
  if (typeof o.stringName !== "string" || o.stringName.trim().length < 2) {
    out.push("body.context.override.stringName must be a non-empty string");
  }
  if (typeof o.command !== "string" || o.command.trim().length < 2) {
    out.push("body.context.override.command must be a non-empty string");
  }
  return out;
}

function validateActorExternalId(ctx: Record<string, unknown>): string[] {
  const out: string[] = [];
  const v = ctx.actorExternalId;
  if (v === undefined) return out;
  if (typeof v !== "string" || v.trim().length < 3) {
    out.push("body.context.actorExternalId must be a non-empty string when present");
  }
  return out;
}

/**
 * Validates JSON body for POST /chat: only known keys; no override vocabulary.
 */
export function validateChatRequestBodyShape(body: unknown): { ok: true } | { ok: false; violations: string[] } {
  const violations: string[] = [];

  if (body === null || body === undefined) {
    return { ok: false, violations: ["body is required"] };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, violations: ["body must be a JSON object"] };
  }

  const o = body as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      violations.push(`Unknown or disallowed top-level field: "${key}"`);
    }
  }

  violations.push(...violationsForForbiddenKeys(o, "body"));

  const ctx = o.context;
  if (ctx !== undefined) {
    if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) {
      violations.push(`body.context must be an object when present`);
    } else {
      violations.push(...violationsForForbiddenKeys(ctx as Record<string, unknown>, "body.context"));
      violations.push(...validateActorExternalId(ctx as Record<string, unknown>));
      violations.push(...validateOverrideContext(ctx as Record<string, unknown>));
    }
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
