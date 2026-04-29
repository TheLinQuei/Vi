import { z } from "zod";

const OrchestrationEnvSchema = z.object({
  VI_PROVIDER: z.enum(["openai", "xai", "gemini", "vertexai"]).default("openai"),
  VI_MODEL_ROUTER_ENABLED: z.enum(["true", "false"]).default("true"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_MODEL_REASONING: z.string().optional(),
  OPENAI_MODEL_CODE: z.string().optional(),
  OPENAI_MODEL_CREATIVE: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  XAI_MODEL: z.string().default("grok-4-fast-reasoning"),
  XAI_MODEL_REASONING: z.string().optional(),
  XAI_MODEL_CODE: z.string().optional(),
  XAI_MODEL_CREATIVE: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_MODEL_REASONING: z.string().optional(),
  GEMINI_MODEL_CODE: z.string().optional(),
  GEMINI_MODEL_CREATIVE: z.string().optional(),
  GEMINI_MODEL_EVALUATIVE: z.string().optional(),
  VERTEXAI_PROJECT: z.string().optional(),
  VERTEXAI_LOCATION: z.string().default("us-central1"),
  VERTEXAI_MODEL: z.string().default("gemini-2.5-flash"),
  VERTEXAI_MODEL_REASONING: z.string().optional(),
  VERTEXAI_MODEL_CODE: z.string().optional(),
  VERTEXAI_MODEL_CREATIVE: z.string().optional(),
  VERTEXAI_MODEL_EVALUATIVE: z.string().optional(),
  OPENAI_MODEL_EVALUATIVE: z.string().optional(),
  XAI_MODEL_EVALUATIVE: z.string().optional(),
  VI_DEBUG_CONTEXT: z.string().optional(),
});

export type OrchestrationEnv = z.infer<typeof OrchestrationEnvSchema>;
export const orchEnv = OrchestrationEnvSchema.parse(process.env);
