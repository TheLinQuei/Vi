import OpenAI from "openai";
import type { OrchestrationEnv } from "../env.js";
import type { ProviderAdapter, ProviderMessage, ProviderResult } from "../provider.js";

export class OpenAIProvider implements ProviderAdapter {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(env: OrchestrationEnv) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY for VI_PROVIDER=openai");
    }
    this.model = env.OPENAI_MODEL;
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async generateReply(
    messages: ProviderMessage[],
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<ProviderResult> {
    const model = options?.model ?? this.model;
    const completion = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });
    return { text: completion.choices[0]?.message?.content ?? "", model };
  }
}
