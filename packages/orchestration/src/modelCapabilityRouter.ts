import type { ChatHistoryMessage } from "@vi/shared";
import type { OrchestrationEnv } from "./env.js";

export type TurnTask = "default" | "reasoning" | "code" | "creative" | "vision";

export function detectTurnTask(
  message: string,
  history: ChatHistoryMessage[],
  hasImages: boolean,
): TurnTask {
  if (hasImages) return "vision";
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

type PickOpts = {
  base: string;
  evaluative?: string;
  reasoning?: string;
  code?: string;
  creative?: string;
  vision?: string;
};

function pickModel(task: TurnTask, wantsEvaluative: boolean, opts: PickOpts): string {
  if (task === "vision" && opts.vision) return opts.vision;
  if (task === "code" && opts.code) return opts.code;
  if (task === "creative" && opts.creative) return opts.creative;
  if (task === "reasoning" && opts.reasoning) return opts.reasoning;
  if (wantsEvaluative && opts.evaluative) return opts.evaluative;
  return opts.base;
}

export function selectModelForTurn(input: {
  env: OrchestrationEnv;
  responseMode?: "descriptive" | "evaluative";
  message: string;
  history: ChatHistoryMessage[];
  hasImages: boolean;
}): { model: string; task: TurnTask } {
  const provider = input.env.VI_PROVIDER;
  const wantsEvaluative = input.responseMode === "evaluative";
  const routerEnabled = input.env.VI_MODEL_ROUTER_ENABLED !== "false";
  const task = routerEnabled
    ? detectTurnTask(input.message, input.history, input.hasImages)
    : input.hasImages
      ? "vision"
      : "default";

  if (provider === "vertexai") {
    return {
      model: pickModel(task, wantsEvaluative, {
        base: input.env.VERTEXAI_MODEL,
        evaluative: input.env.VERTEXAI_MODEL_EVALUATIVE,
        reasoning: input.env.VERTEXAI_MODEL_REASONING,
        code: input.env.VERTEXAI_MODEL_CODE,
        creative: input.env.VERTEXAI_MODEL_CREATIVE,
        vision: input.env.VERTEXAI_MODEL_VISION ?? input.env.VERTEXAI_MODEL,
      }),
      task,
    };
  }
  if (provider === "xai") {
    return {
      model: pickModel(task, wantsEvaluative, {
        base: input.env.XAI_MODEL,
        evaluative: input.env.XAI_MODEL_EVALUATIVE,
        reasoning: input.env.XAI_MODEL_REASONING,
        code: input.env.XAI_MODEL_CODE,
        creative: input.env.XAI_MODEL_CREATIVE,
        vision: input.env.XAI_MODEL_VISION ?? input.env.XAI_MODEL,
      }),
      task,
    };
  }
  if (provider === "gemini") {
    return {
      model: pickModel(task, wantsEvaluative, {
        base: input.env.GEMINI_MODEL,
        evaluative: input.env.GEMINI_MODEL_EVALUATIVE,
        reasoning: input.env.GEMINI_MODEL_REASONING,
        code: input.env.GEMINI_MODEL_CODE,
        creative: input.env.GEMINI_MODEL_CREATIVE,
        vision: input.env.GEMINI_MODEL_VISION ?? input.env.GEMINI_MODEL,
      }),
      task,
    };
  }
  return {
    model: pickModel(task, wantsEvaluative, {
      base: input.env.OPENAI_MODEL,
      evaluative: input.env.OPENAI_MODEL_EVALUATIVE,
      reasoning: input.env.OPENAI_MODEL_REASONING,
      code: input.env.OPENAI_MODEL_CODE,
      creative: input.env.OPENAI_MODEL_CREATIVE,
      vision: input.env.OPENAI_MODEL_VISION ?? input.env.OPENAI_MODEL,
    }),
    task,
  };
}
