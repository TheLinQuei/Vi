import { VI_SYSTEM_PROMPT } from "@vi/core/personality/viPrompt";
import type { ChatHistoryMessage } from "@vi/shared";
import { getProviderAdapter, type ProviderName } from "./provider.js";
import { orchEnv } from "./env.js";

type ActiveProviderModel = {
  provider: ProviderName;
  model: string;
};

export function getActiveProviderModel(): ActiveProviderModel {
  const provider = orchEnv.VI_PROVIDER;
  if (provider === "xai") {
    return { provider, model: orchEnv.XAI_MODEL };
  }
  if (provider === "gemini") {
    return { provider, model: orchEnv.GEMINI_MODEL };
  }
  if (provider === "vertexai") {
    return { provider, model: orchEnv.VERTEXAI_MODEL };
  }
  return { provider, model: orchEnv.OPENAI_MODEL };
}

function selectModelForTurn(responseMode?: "descriptive" | "evaluative"): string {
  const provider = orchEnv.VI_PROVIDER;
  const wantsEvaluative = responseMode === "evaluative";
  if (provider === "vertexai") {
    return wantsEvaluative
      ? (orchEnv.VERTEXAI_MODEL_EVALUATIVE ?? orchEnv.VERTEXAI_MODEL)
      : orchEnv.VERTEXAI_MODEL;
  }
  if (provider === "xai") {
    return wantsEvaluative ? (orchEnv.XAI_MODEL_EVALUATIVE ?? orchEnv.XAI_MODEL) : orchEnv.XAI_MODEL;
  }
  if (provider === "gemini") {
    return wantsEvaluative
      ? (orchEnv.GEMINI_MODEL_EVALUATIVE ?? orchEnv.GEMINI_MODEL)
      : orchEnv.GEMINI_MODEL;
  }
  return wantsEvaluative ? (orchEnv.OPENAI_MODEL_EVALUATIVE ?? orchEnv.OPENAI_MODEL) : orchEnv.OPENAI_MODEL;
}

export async function generateReply(
  message: string,
  history: ChatHistoryMessage[],
  options?: {
    rollingSummary?: string | null;
    recallSystemMessages?: Array<{ role: "system"; content: string }>;
    responseMode?: "descriptive" | "evaluative";
  },
): Promise<{
  text: string;
  provider: ProviderName;
  model: string;
  providerNotice?: string;
}> {
  const adapter = await getProviderAdapter();
  if (orchEnv.VI_DEBUG_CONTEXT === "true") {
    console.log("[VI_PROVIDER_MODEL]", {
      provider: adapter.name,
      model: adapter.model,
    });
  }

  const recap = options?.rollingSummary?.trim();
  const recapMessage = recap
    ? ([
        {
          role: "system" as const,
          content: `Rolling session recap (paraphrased; for continuity only, not verbatim):\n${recap}`,
        },
      ] as const)
    : [];

  const recallBlock = options?.recallSystemMessages ?? [];

  const messages = [
    { role: "system" as const, content: VI_SYSTEM_PROMPT },
    ...recapMessage,
    ...recallBlock,
    ...history.map((item) => ({ role: item.role as "user" | "assistant", content: item.content })),
    { role: "user" as const, content: message },
  ];

  const selectedModel = selectModelForTurn(options?.responseMode);
  const result = await adapter.generateReply(messages, { model: selectedModel });
  return {
    text: result.text,
    provider: adapter.name,
    model: result.model ?? selectedModel,
    providerNotice: result.providerNotice,
  };
}
