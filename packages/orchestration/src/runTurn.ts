import { enforceVoiceReply } from "@vi/core/humanity/voice/enforceVoice";
import { generateReply } from "./openai.js";
import type { ProviderName } from "./provider.js";
import type { ChatHistoryMessage, ViEmotionalPostureV1, ViStanceV1 } from "@vi/shared";

export { refreshRollingSessionSummaryIfDue } from "./rollingSummary.js";
export { buildRecallSystemMessages, RECALL_EXCLUDE_RECENT_COUNT, looksLikeRecallQuestion } from "./recallSearch.js";

export async function runTurn(input: {
  message: string;
  history: ChatHistoryMessage[];
  rollingSummary?: string | null;
  recallSystemMessages?: Array<{ role: "system"; content: string }>;
  humanity?: {
    wantsIntent?: "none" | "preference_choice" | "improvement_eval" | "fit_eval" | "depth_eval";
    responseMode?: "descriptive" | "evaluative";
    posture?: ViEmotionalPostureV1;
    userRole?: "owner" | "guest";
  };
  stance?: ViStanceV1;
  continuity?: {
    hasIdleReflectionMatch?: boolean;
  };
}): Promise<{
  reply: string;
  model: string;
  provider: ProviderName;
  providerNotice?: string;
}> {
  const generated = await generateReply(input.message, input.history, {
    rollingSummary: input.rollingSummary,
    recallSystemMessages: input.recallSystemMessages,
    responseMode: input.humanity?.responseMode,
  });
  const reply = enforceVoiceReply(generated.text, {
    humanity: input.humanity,
    stance: input.stance,
    userMessage: input.message,
    continuity: input.continuity,
  });
  return {
    reply,
    model: generated.model,
    provider: generated.provider,
    providerNotice: generated.providerNotice,
  };
}
