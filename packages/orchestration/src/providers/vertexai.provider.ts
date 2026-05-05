import { VertexAI } from "@google-cloud/vertexai";
import type { OrchestrationEnv } from "../env.js";
import type { ProviderAdapter, ProviderMessage, ProviderMessageContent, ProviderResult } from "../provider.js";
import { fetchImageAsBase64 } from "../secureImageFetch.js";

function flattenTextOnly(content: ProviderMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

async function contentToVertexParts(content: ProviderMessageContent): Promise<Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>> {
  if (typeof content === "string") return [{ text: content }];
  const out: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  for (const p of content) {
    if (p.type === "text") out.push({ text: p.text });
    if (p.type === "image_url") {
      const img = await fetchImageAsBase64(p.image_url.url);
      out.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }
  return out.length > 0 ? out : [{ text: "" }];
}

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
    const nonSystem = messages.filter((message) => message.role !== "system");

    const contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> =
      [];
    for (const message of nonSystem) {
      const role = message.role === "assistant" ? "model" : "user";
      const parts = await contentToVertexParts(message.content);
      contents.push({ role, parts });
    }

    const result = await model.generateContent({
      systemInstruction:
        systemMessages.length > 0
          ? {
              parts: systemMessages.map((message) => ({ text: flattenTextOnly(message.content) })),
            }
          : undefined,
      contents,
    } as never);

    const respParts = result.response.candidates?.[0]?.content?.parts ?? [];
    const text = respParts.map((part) => part.text ?? "").join("");
    return { text, model: modelName };
  }
}
