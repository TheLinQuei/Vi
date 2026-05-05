/**
 * Optional client hints: multimodal inputs and routing lane (OSS / open-weights).
 * Adapters (e.g. Vigil) set `context` keys; never include forbidden adapter keys.
 */

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/** HTTPS image URLs (Discord CDN, GCS, etc.) — must pass Vi’s fetch allowlist in orchestration. */
export function parseMultimodalImageUrls(context: unknown): string[] {
  const c = readRecord(context);
  if (!c) return [];
  const out: string[] = [];
  const discord = readRecord(c.discord);
  const dUrls = discord?.imageUrls;
  if (Array.isArray(dUrls)) {
    for (const u of dUrls) {
      if (typeof u === "string" && u.startsWith("https://")) out.push(u);
    }
  }
  const vi = readRecord(c.vi);
  const mm = readRecord(vi?.multimodal);
  const mUrls = mm?.imageUrls;
  if (Array.isArray(mUrls)) {
    for (const u of mUrls) {
      if (typeof u === "string" && u.startsWith("https://")) out.push(u);
    }
  }
  return [...new Set(out)].slice(0, 8);
}

/**
 * When true, use `VI_OSS_BASE_URL` OpenAI-compatible endpoint for this turn (if configured).
 * Set `context.vi.preferOpenWeights: true` or `context.vi.routing.lane: "open_weights" | "oss"`.
 */
export function parseViTurnRouting(context: unknown): { preferOpenWeights: boolean } {
  const c = readRecord(context);
  if (!c) return { preferOpenWeights: false };
  const vi = readRecord(c.vi);
  if (!vi) return { preferOpenWeights: false };
  if (vi.preferOpenWeights === true) return { preferOpenWeights: true };
  const routing = readRecord(vi.routing);
  const lane = typeof routing?.lane === "string" ? routing.lane.toLowerCase() : "";
  if (lane === "open_weights" || lane === "oss" || lane === "open") return { preferOpenWeights: true };
  return { preferOpenWeights: false };
}

export type ViToolingContext = {
  webSearchEnabled: boolean;
  docsSearchEnabled: boolean;
  connectorsEnabled: boolean;
  mediaGenerationEnabled: boolean;
  voiceInputMode: "voice" | "text";
};

/**
 * Optional capability hints from adapter context:
 * - `vi.tools.webSearch`
 * - `vi.tools.docsSearch`
 * - `vi.tools.connectors`
 * - `vi.tools.mediaGeneration`
 * - `vi.voice.inputMode` = "voice" | "text"
 */
export function parseViToolingContext(context: unknown): ViToolingContext {
  const c = readRecord(context);
  const vi = readRecord(c?.vi);
  const tools = readRecord(vi?.tools);
  const voice = readRecord(vi?.voice);
  const inputMode = voice?.inputMode === "voice" ? "voice" : "text";
  return {
    webSearchEnabled: tools?.webSearch === true,
    docsSearchEnabled: tools?.docsSearch === true,
    connectorsEnabled: tools?.connectors === true,
    mediaGenerationEnabled: tools?.mediaGeneration === true,
    voiceInputMode: inputMode,
  };
}
