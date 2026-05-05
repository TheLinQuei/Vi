import OpenAI from "openai";
import type { OrchestrationEnv } from "../env.js";
import type { ProviderAdapter, ProviderMessage, ProviderResult } from "../provider.js";

export class GeminiCompatProvider implements ProviderAdapter {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(env: OrchestrationEnv) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY for VI_PROVIDER=gemini");
    }
    this.model = env.GEMINI_MODEL;
    this.client = new OpenAI({
      apiKey: env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
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
