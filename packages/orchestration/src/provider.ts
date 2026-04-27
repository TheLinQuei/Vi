import { orchEnv } from "./env.js";

export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderResult = {
  text: string;
  providerNotice?: string;
  model?: string;
};

export interface ProviderAdapter {
  readonly name: "openai" | "xai" | "gemini" | "vertexai";
  readonly model: string;
  generateReply(
    messages: ProviderMessage[],
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<ProviderResult>;
}

export type ProviderName = ProviderAdapter["name"];

let adapterPromise: Promise<ProviderAdapter> | null = null;

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
