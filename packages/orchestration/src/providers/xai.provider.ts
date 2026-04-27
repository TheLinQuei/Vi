import OpenAI from "openai";
import type { OrchestrationEnv } from "../env.js";
import type { ProviderAdapter, ProviderMessage, ProviderResult } from "../provider.js";

export class XAIProvider implements ProviderAdapter {
  readonly name = "xai" as const;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly fallbackClient: OpenAI | null;
  private readonly fallbackModel: string | null;

  constructor(env: OrchestrationEnv) {
    if (!env.XAI_API_KEY) {
      throw new Error("Missing XAI_API_KEY for VI_PROVIDER=xai");
    }
    this.model = env.XAI_MODEL;
    this.client = new OpenAI({
      apiKey: env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });

    if (env.OPENAI_API_KEY) {
      this.fallbackClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      this.fallbackModel = env.OPENAI_MODEL;
    } else {
      this.fallbackClient = null;
      this.fallbackModel = null;
    }
  }

  async generateReply(
    messages: ProviderMessage[],
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<ProviderResult> {
    const model = options?.model ?? this.model;
    try {
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });
      return { text: completion.choices[0]?.message?.content ?? "", model };
    } catch (error) {
      if (!this.shouldFallback(error) || !this.fallbackClient || !this.fallbackModel) {
        throw error;
      }
      const fallbackModel = this.fallbackModel;
      const fallback = await this.fallbackClient.chat.completions.create({
        model: fallbackModel,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });
      return {
        text: fallback.choices[0]?.message?.content ?? "",
        model: fallbackModel,
        providerNotice:
          "XAI is rate-limited or out of credits; this turn used OpenAI fallback automatically.",
      };
    }
  }

  private shouldFallback(error: unknown): boolean {
    const e = error as { status?: number; message?: string };
    const msg = (e?.message ?? String(error)).toLowerCase();
    return e?.status === 429 || /\b(rate limit|credits|spending limit|monthly)\b/.test(msg);
  }
}
