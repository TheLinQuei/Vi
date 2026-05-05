import { VI_SYSTEM_PROMPT } from "@vi/core/personality/viPrompt";
import type { ChatHistoryMessage } from "@vi/shared";
import { selectModelForTurn } from "./modelCapabilityRouter.js";
import {
  getGenerationAdapter,
  type ProviderContentPart,
  type ProviderMessage,
  type ProviderMessageContent,
  type ProviderName,
} from "./provider.js";
import { orchEnv } from "./env.js";

export type ActiveProviderModel = {
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

function looksLikeThreadScopedSynthesisAsk(message: string): boolean {
  const q = message.toLowerCase();
  const scoped =
    /\b(this chat|our chat|the chat|chat only|this conversation|our conversation|this thread|this transcript|from this (?:chat|conversation)|based only on (?:this|the) chat)\b/.test(
      q,
    );
  const asksSummary =
    /\b(top priority|main objective|immediate next action|next action|what matters most|clear weakness|weakness|what do i care|summarize my intent)\b/.test(
      q,
    );
  const finalCheckCombo =
    /^\s*final check\b/i.test(message.trim()) &&
    /\b(top priority|immediate next action|next action)\b/.test(q);
  return (scoped && asksSummary) || finalCheckCombo;
}

function threadScopedSynthesisSystemBlock(
  message: string,
  history: ChatHistoryMessage[],
): { role: "system"; content: string } | null {
  if (!looksLikeThreadScopedSynthesisAsk(message)) return null;
  const prior = history.length;
  if (prior === 0) {
    return {
      role: "system",
      content:
        "Thread note: this is the first user message in this session—there are no earlier turns in your context. Infer the user's aim only from this message; do not claim missing history as an error.",
    };
  }
  return {
    role: "system",
    content: `Thread note: ${prior} prior message(s) appear before this turn (user and assistant). The user wants a synthesis scoped to this session—use those lines as evidence; do not claim the thread lacks information about their priorities or next steps.`,
  };
}

function buildUserMessageContent(message: string, imageUrls: string[]): ProviderMessageContent {
  const capped = imageUrls.slice(0, 8);
  if (capped.length === 0) return message;
  const parts: ProviderContentPart[] = [];
  for (const url of capped) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  parts.push({ type: "text", text: message });
  return parts;
}

export async function generateReply(
  message: string,
  history: ChatHistoryMessage[],
  options?: {
    rollingSummary?: string | null;
    recallSystemMessages?: Array<{ role: "system"; content: string }>;
    responseMode?: "descriptive" | "evaluative";
    imageUrls?: string[];
    preferOpenWeights?: boolean;
    tools?: {
      webSearchEnabled?: boolean;
      docsSearchEnabled?: boolean;
      connectorsEnabled?: boolean;
      mediaGenerationEnabled?: boolean;
    };
    voice?: { inputMode?: "voice" | "text" };
  },
): Promise<{
  text: string;
  provider: ProviderName;
  model: string;
  providerNotice?: string;
}> {
  const imageUrls = options?.imageUrls ?? [];
  const adapter = await getGenerationAdapter({
    preferOpenWeights: options?.preferOpenWeights ?? false,
  });

  if (orchEnv.VI_DEBUG_CONTEXT === "true") {
    console.log("[VI_PROVIDER_MODEL]", {
      provider: adapter.name,
      model: adapter.model,
      images: imageUrls.length,
      ossLane: options?.preferOpenWeights ?? false,
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
  const threadScopedBlock = threadScopedSynthesisSystemBlock(message, history);
  const threadHint = threadScopedBlock ? [threadScopedBlock] : [];
  const capabilityHints = buildCapabilitySystemHints(options);

  const searchEnvelope = maybeBuildSearchToolEnvelope(message, {
    webSearchEnabled: options?.tools?.webSearchEnabled === true,
    docsSearchEnabled: options?.tools?.docsSearchEnabled === true,
  });
  if (searchEnvelope) {
    return {
      text: searchEnvelope,
      provider: adapter.name,
      model: "routing:search-tool-envelope-v1",
      providerNotice:
        "Tool envelope emitted for search/docs lookup; route this envelope to the search tool executor.",
    };
  }

  const mediaEnvelope = maybeBuildMediaToolEnvelope(message, options?.tools?.mediaGenerationEnabled === true);
  if (mediaEnvelope) {
    return {
      text: mediaEnvelope,
      provider: adapter.name,
      model: "routing:media-tool-envelope-v1",
      providerNotice:
        "Tool envelope emitted for media generation; route this envelope to the media tool executor.",
    };
  }

  const userContent = buildUserMessageContent(message, imageUrls);

  const messages: ProviderMessage[] = [
    { role: "system", content: VI_SYSTEM_PROMPT },
    ...recapMessage,
    ...recallBlock,
    ...threadHint,
    ...capabilityHints,
    ...history.map((item) => ({ role: item.role as "user" | "assistant", content: item.content })),
    { role: "user", content: userContent },
  ];

  const selection = selectModelForTurn({
    env: orchEnv,
    responseMode: options?.responseMode,
    message,
    history,
    hasImages: imageUrls.length > 0,
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

function buildCapabilitySystemHints(options: {
  tools?: {
    webSearchEnabled?: boolean;
    docsSearchEnabled?: boolean;
    connectorsEnabled?: boolean;
    mediaGenerationEnabled?: boolean;
  };
  voice?: { inputMode?: "voice" | "text" };
} | undefined): Array<{ role: "system"; content: string }> {
  if (!options) return [];
  const lines: string[] = [];
  if (options.tools?.webSearchEnabled) {
    lines.push("- webSearch tool is available for current/live facts and citations.");
  }
  if (options.tools?.docsSearchEnabled) {
    lines.push("- docsSearch tool is available for repository/internal documentation lookup.");
  }
  if (options.tools?.connectorsEnabled) {
    lines.push("- connectors toolchain is available (external systems/integrations).");
  }
  if (options.tools?.mediaGenerationEnabled) {
    lines.push(
      "- media generation tools are available. For direct image/video generation asks, return a TOOL_ENVELOPE payload.",
    );
  }
  if (options.voice?.inputMode === "voice") {
    lines.push("- user is on voice input; prefer short, speakable phrasing and avoid dense formatting.");
  }
  if (lines.length === 0) return [];
  return [
    {
      role: "system",
      content: ["Runtime capability hints for this turn:", ...lines].join("\n"),
    },
  ];
}

function maybeBuildMediaToolEnvelope(message: string, enabled: boolean): string | null {
  if (!enabled) return null;
  const t = message.trim();
  const m = t.toLowerCase();
  const wantsImage =
    /\b(generate|create|make|draw|render)\b/.test(m) && /\b(image|picture|art|illustration|wallpaper|icon)\b/.test(m);
  const wantsVideo =
    /\b(generate|create|make|render)\b/.test(m) && /\b(video|clip|animation|movie)\b/.test(m);
  if (!wantsImage && !wantsVideo) return null;
  const toolName = wantsVideo ? "media.generate_video" : "media.generate_image";
  return JSON.stringify(
    {
      type: "TOOL_ENVELOPE",
      tool: toolName,
      args: {
        prompt: t,
        style: "auto",
        safetyProfile: "default",
      },
      reason: "user requested media generation and media tool lane is enabled",
    },
    null,
    2,
  );
}

function maybeBuildSearchToolEnvelope(
  message: string,
  enabled: { webSearchEnabled: boolean; docsSearchEnabled: boolean },
): string | null {
  const t = message.trim();
  const m = t.toLowerCase();
  const asksWeb =
    enabled.webSearchEnabled &&
    (/\b(current|latest|today|news|price|release|breaking|what happened)\b/.test(m) ||
      /\bsearch the web\b/.test(m));
  const asksDocs =
    enabled.docsSearchEnabled &&
    (/\bsearch (the )?docs\b/.test(m) ||
      /\bin the docs\b/.test(m) ||
      /\bfind (in|within) (the )?(repo|codebase|documentation)\b/.test(m));
  if (!asksWeb && !asksDocs) return null;
  const toolName = asksDocs ? "docs.search" : "web.search";
  return JSON.stringify(
    {
      type: "TOOL_ENVELOPE",
      tool: toolName,
      args: {
        query: t,
        maxResults: 6,
      },
      reason: asksDocs ? "user requested docs/repo lookup" : "user requested live web search",
    },
    null,
    2,
  );
}
