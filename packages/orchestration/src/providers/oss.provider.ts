import OpenAI from "openai";
import type { OrchestrationEnv } from "../env.js";
import type { ProviderAdapter, ProviderMessage, ProviderResult } from "../provider.js";

/**
 * OpenAI-compatible HTTP API (vLLM, LiteLLM, Ollama `--api` style servers, Vertex endpoints with compat layer, etc.).
 */
export class OssOpenAiProvider implements ProviderAdapter {
  readonly name = "oss" as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(env: OrchestrationEnv) {
    const base = env.VI_OSS_BASE_URL?.trim();
    if (!base) {
      throw new Error("Missing VI_OSS_BASE_URL for OSS provider");
    }
    this.model = env.VI_OSS_MODEL;
    this.client = new OpenAI({
      apiKey: env.VI_OSS_API_KEY ?? "ollama",
      baseURL: base.replace(/\/$/, ""),
    });
  }

  async generateReply(
    messages: ProviderMessage[],
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<ProviderResult> {
    const model = options?.model ?? this.model;
    const completion = await this.client.chat.completions.create({
      model,
      messages: messages as never,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });
    return { text: completion.choices[0]?.message?.content ?? "", model };
  }
}
