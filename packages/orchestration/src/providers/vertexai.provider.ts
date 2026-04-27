import { VertexAI } from "@google-cloud/vertexai";
import type { OrchestrationEnv } from "../env.js";
import type { ProviderAdapter, ProviderMessage, ProviderResult } from "../provider.js";

export class VertexAIProvider implements ProviderAdapter {
  readonly name = "vertexai" as const;
  readonly model: string;
  private readonly vertexAI: VertexAI;

  constructor(env: OrchestrationEnv) {
    if (!env.VERTEXAI_PROJECT) {
      throw new Error("Missing VERTEXAI_PROJECT for VI_PROVIDER=vertexai");
    }
    this.model = env.VERTEXAI_MODEL;
    this.vertexAI = new VertexAI({
      project: env.VERTEXAI_PROJECT,
      location: env.VERTEXAI_LOCATION,
    });
  }

  async generateReply(
    messages: ProviderMessage[],
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<ProviderResult> {
    const modelName = options?.model ?? this.model;
    const model = this.vertexAI.getGenerativeModel({ model: modelName });
    const systemMessages = messages.filter((message) => message.role === "system");
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    const result = await model.generateContent({
      systemInstruction:
        systemMessages.length > 0
          ? {
              parts: systemMessages.map((message) => ({ text: message.content })),
            }
          : undefined,
      contents,
    });

    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return { text, model: modelName };
  }
}
