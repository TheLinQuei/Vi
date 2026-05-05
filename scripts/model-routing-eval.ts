import type { OrchestrationEnv } from "../packages/orchestration/src/env.js";
import { selectModelForTurn } from "../packages/orchestration/src/modelCapabilityRouter.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const baseEnv: OrchestrationEnv = {
  VI_PROVIDER: "vertexai",
  VI_MODEL_ROUTER_ENABLED: "true",
  OPENAI_API_KEY: undefined,
  OPENAI_MODEL: "gpt-4o-mini",
  OPENAI_MODEL_REASONING: undefined,
  OPENAI_MODEL_CODE: undefined,
  OPENAI_MODEL_CREATIVE: undefined,
  OPENAI_MODEL_VISION: undefined,
  XAI_API_KEY: undefined,
  XAI_MODEL: "grok-4-fast-reasoning",
  XAI_MODEL_REASONING: undefined,
  XAI_MODEL_CODE: undefined,
  XAI_MODEL_CREATIVE: undefined,
  XAI_MODEL_VISION: undefined,
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: "gemini-2.5-flash",
  GEMINI_MODEL_REASONING: undefined,
  GEMINI_MODEL_CODE: undefined,
  GEMINI_MODEL_CREATIVE: undefined,
  GEMINI_MODEL_EVALUATIVE: undefined,
  GEMINI_MODEL_VISION: undefined,
  VERTEXAI_PROJECT: "proj",
  VERTEXAI_LOCATION: "us-central1",
  VERTEXAI_MODEL: "gemini-2.5-flash",
  VERTEXAI_MODEL_REASONING: "gemini-2.5-pro",
  VERTEXAI_MODEL_CODE: "gemini-2.5-pro",
  VERTEXAI_MODEL_CREATIVE: undefined,
  VERTEXAI_MODEL_EVALUATIVE: "gemini-2.5-pro",
  VERTEXAI_MODEL_VISION: "gemini-2.5-flash-image",
  OPENAI_MODEL_EVALUATIVE: undefined,
  XAI_MODEL_EVALUATIVE: undefined,
  VI_OSS_BASE_URL: undefined,
  VI_OSS_API_KEY: undefined,
  VI_OSS_MODEL: "meta-llama/Llama-3.3-70B-Instruct",
  VI_MULTIMODAL_FETCH_MAX_BYTES: 4_194_304,
  VI_MULTIMODAL_URL_ALLOWLIST: undefined,
  VI_DEBUG_CONTEXT: undefined,
};

function run(): void {
  const history = [{ role: "user" as const, content: "hello" }];
  const code = selectModelForTurn({
    env: baseEnv,
    message: "fix this TypeScript compile error in my function",
    history,
    hasImages: false,
  });
  assert(code.task === "code", "code task should be detected");
  assert(code.model === "gemini-2.5-pro", "code task should choose code model");

  const vision = selectModelForTurn({
    env: baseEnv,
    message: "what's in this image?",
    history,
    hasImages: true,
  });
  assert(vision.task === "vision", "images should force vision task");
  assert(vision.model === "gemini-2.5-flash-image", "vision task should choose vision model");

  const evalMode = selectModelForTurn({
    env: baseEnv,
    message: "compare these options",
    history,
    hasImages: false,
    responseMode: "evaluative",
  });
  assert(evalMode.model === "gemini-2.5-pro", "evaluative mode should choose evaluative model");

  console.log("- [PASS] Model capability router invariants");
}

run();
