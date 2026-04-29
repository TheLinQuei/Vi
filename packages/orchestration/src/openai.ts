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

type TurnTask = "default" | "reasoning" | "code" | "creative";

function detectTurnTask(message: string, history: ChatHistoryMessage[]): TurnTask {
  const text = `${history.slice(-2).map((h) => h.content).join("\n")}\n${message}`.toLowerCase();
  if (
    /\b(code|typescript|javascript|python|sql|query|stack trace|traceback|refactor|function|class|compile|bug|error|test case|unit test|regex|api endpoint)\b/.test(
      text,
    )
  ) {
    return "code";
  }
  if (
    /\b(write a story|poem|lyrics|creative|roleplay|scene|fiction|character dialogue|brainstorm names|worldbuilding)\b/.test(
      text,
    )
  ) {
    return "creative";
  }
  if (
    /\b(compare|trade-?off|architecture|plan|strategy|why|analyze|diagnose|root cause|evaluate|reason step|decision)\b/.test(
      text,
    )
  ) {
    return "reasoning";
  }
  return "default";
}

function selectModelForTurn(input: {
  responseMode?: "descriptive" | "evaluative";
  message: string;
  history: ChatHistoryMessage[];
}): { model: string; task: TurnTask } {
  const provider = orchEnv.VI_PROVIDER;
  const wantsEvaluative = input.responseMode === "evaluative";
  const routerEnabled = orchEnv.VI_MODEL_ROUTER_ENABLED !== "false";
  const task = routerEnabled ? detectTurnTask(input.message, input.history) : "default";

  const pick = (opts: {
    base: string;
    evaluative?: string;
    reasoning?: string;
    code?: string;
    creative?: string;
  }): string => {
    if (task === "code" && opts.code) return opts.code;
    if (task === "creative" && opts.creative) return opts.creative;
    if (task === "reasoning" && opts.reasoning) return opts.reasoning;
    if (wantsEvaluative && opts.evaluative) return opts.evaluative;
    return opts.base;
  };

  if (provider === "vertexai") {
    return {
      model: pick({
        base: orchEnv.VERTEXAI_MODEL,
        evaluative: orchEnv.VERTEXAI_MODEL_EVALUATIVE,
        reasoning: orchEnv.VERTEXAI_MODEL_REASONING,
        code: orchEnv.VERTEXAI_MODEL_CODE,
        creative: orchEnv.VERTEXAI_MODEL_CREATIVE,
      }),
      task,
    };
  }
  if (provider === "xai") {
    return {
      model: pick({
        base: orchEnv.XAI_MODEL,
        evaluative: orchEnv.XAI_MODEL_EVALUATIVE,
        reasoning: orchEnv.XAI_MODEL_REASONING,
        code: orchEnv.XAI_MODEL_CODE,
        creative: orchEnv.XAI_MODEL_CREATIVE,
      }),
      task,
    };
  }
  if (provider === "gemini") {
    return {
      model: pick({
        base: orchEnv.GEMINI_MODEL,
        evaluative: orchEnv.GEMINI_MODEL_EVALUATIVE,
        reasoning: orchEnv.GEMINI_MODEL_REASONING,
        code: orchEnv.GEMINI_MODEL_CODE,
        creative: orchEnv.GEMINI_MODEL_CREATIVE,
      }),
      task,
    };
  }
  return {
    model: pick({
      base: orchEnv.OPENAI_MODEL,
      evaluative: orchEnv.OPENAI_MODEL_EVALUATIVE,
      reasoning: orchEnv.OPENAI_MODEL_REASONING,
      code: orchEnv.OPENAI_MODEL_CODE,
      creative: orchEnv.OPENAI_MODEL_CREATIVE,
    }),
    task,
  };
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

  const selection = selectModelForTurn({
    responseMode: options?.responseMode,
    message,
    history,
  });
  const selectedModel = selection.model;
  if (orchEnv.VI_DEBUG_CONTEXT === "true") {
    console.log("[VI_MODEL_ROUTER]", {
      provider: adapter.name,
      task: selection.task,
      selectedModel,
      responseMode: options?.responseMode ?? "descriptive",
    });
  }
  const result = await adapter.generateReply(messages, { model: selectedModel });
  return {
    text: result.text,
    provider: adapter.name,
    model: result.model ?? selectedModel,
    providerNotice: result.providerNotice,
  };
}
