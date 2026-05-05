import { orchEnv } from "./env.js";

/** Text block or multimodal parts (OpenAI-style); Vertex adapter maps inline. */
export type ProviderContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ProviderMessageContent = string | ProviderContentPart[];

export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: ProviderMessageContent;
};

export type ProviderResult = {
  text: string;
  providerNotice?: string;
  model?: string;
};

export interface ProviderAdapter {
  readonly name: "openai" | "xai" | "gemini" | "vertexai" | "oss";
  readonly model: string;
  generateReply(
    messages: ProviderMessage[],
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<ProviderResult>;
}

export type ProviderName = ProviderAdapter["name"];

let adapterPromise: Promise<ProviderAdapter> | null = null;
let ossSingleton: Promise<ProviderAdapter> | null = null;

export async function getProviderAdapter(): Promise<ProviderAdapter> {
  if (adapterPromise) return adapterPromise;
  adapterPromise = (async () => {
    const provider = orchEnv.VI_PROVIDER;
    if (provider === "vertexai") {
      const { VertexAIProvider } = await import("./providers/vertexai.provider.js");
      return new VertexAIProvider(orchEnv);
    }
    if (provider === "xai") {
      const { XAIProvider } = await import("./providers/xai.provider.js");
      return new XAIProvider(orchEnv);
    }
    if (provider === "gemini") {
      const { GeminiCompatProvider } = await import("./providers/gemini.provider.js");
      return new GeminiCompatProvider(orchEnv);
    }
    const { OpenAIProvider } = await import("./providers/openai.provider.js");
    return new OpenAIProvider(orchEnv);
  })();
  return adapterPromise;
}

async function getOssAdapterInstance(): Promise<ProviderAdapter | null> {
  if (!orchEnv.VI_OSS_BASE_URL?.trim()) return null;
  if (!ossSingleton) {
    ossSingleton = (async () => {
      const { OssOpenAiProvider } = await import("./providers/oss.provider.js");
      return new OssOpenAiProvider(orchEnv);
    })();
  }
  return ossSingleton;
}

/**
 * Primary LLM for this turn. Uses the OSS / open-weights lane when configured and requested via context.
 */
export async function getGenerationAdapter(input: { preferOpenWeights: boolean }): Promise<ProviderAdapter> {
  if (input.preferOpenWeights) {
    const oss = await getOssAdapterInstance();
    if (oss) return oss;
  }
  return getProviderAdapter();
}
