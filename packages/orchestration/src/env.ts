import { z } from "zod";

const OrchestrationEnvSchema = z.object({
  VI_PROVIDER: z.enum(["openai", "xai", "gemini", "vertexai"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  XAI_API_KEY: z.string().optional(),
  XAI_MODEL: z.string().default("grok-4-fast-reasoning"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_MODEL_EVALUATIVE: z.string().optional(),
  VERTEXAI_PROJECT: z.string().optional(),
  VERTEXAI_LOCATION: z.string().default("us-central1"),
  VERTEXAI_MODEL: z.string().default("gemini-2.5-flash"),
  VERTEXAI_MODEL_EVALUATIVE: z.string().optional(),
  OPENAI_MODEL_EVALUATIVE: z.string().optional(),
  XAI_MODEL_EVALUATIVE: z.string().optional(),
  VI_DEBUG_CONTEXT: z.string().optional(),
});

export type OrchestrationEnv = z.infer<typeof OrchestrationEnvSchema>;
export const orchEnv = OrchestrationEnvSchema.parse(process.env);
