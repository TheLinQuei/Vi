type ToolEnvelope = {
  type: "TOOL_ENVELOPE";
  tool: string;
  args?: Record<string, unknown>;
  reason?: string;
};

export type ToolExecutionInput = {
  replyText: string;
  actorExternalId: string;
  sessionId: string;
  context: unknown;
  mediaWebhookUrl?: string;
  mediaWebhookSecret?: string;
  searchWebhookUrl?: string;
  searchWebhookSecret?: string;
};

export type ToolExecutionResult = {
  handled: boolean;
  userReply: string;
  providerNotice?: string;
};

type WebSource = { title: string; url: string; snippet: string };

function parseToolEnvelope(text: string): ToolEnvelope | null {
  const raw = text.trim();
  if (!raw.startsWith("{") || !raw.includes("\"TOOL_ENVELOPE\"")) return null;
  try {
    const parsed = JSON.parse(raw) as ToolEnvelope;
    if (parsed?.type !== "TOOL_ENVELOPE" || typeof parsed.tool !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function readDiscordRoutingContext(context: unknown): { guildId?: string; channelId?: string } {
  const c = readRecord(context);
  const d = readRecord(c?.discord);
  const guildId = typeof d?.guildId === "string" ? d.guildId : undefined;
  const channelId = typeof d?.channelId === "string" ? d.channelId : undefined;
  return { guildId, channelId };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeDdgHref(href: string): string {
  const raw0 = decodeHtmlEntities(href).trim();
  const raw = raw0.startsWith("//") ? `https:${raw0}` : raw0;
  if (raw.includes("/l/?")) {
    const m = raw.match(/[?&]uddg=([^&]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  if (/duckduckgo\.com\/y\.js/i.test(raw)) {
    const m = raw.match(/[?&]u3=([^&]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return raw;
}

function isLikelyAdOrTrackerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("duckduckgo.com") && (u.pathname === "/y.js" || u.pathname.startsWith("/y.js"))) return true;
    if (host.includes("bing.com") && u.pathname.includes("aclick")) return true;
    if (host.includes("doubleclick.net")) return true;
    if (host.includes("googleadservices.com")) return true;
    return false;
  } catch {
    return true;
  }
}

async function fetchDuckDuckGoSources(query: string, limit = 5): Promise<WebSource[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: WebSource[] = [];
    const re =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,4000}?<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(html)) && out.length < limit) {
      const href = normalizeDdgHref(match[1] ?? "");
      const title = stripHtml(match[2] ?? "");
      const snippet = stripHtml(match[3] ?? "");
      if (!href || !/^https?:\/\//i.test(href) || !title) continue;
      if (isLikelyAdOrTrackerUrl(href)) continue;
      out.push({ title, url: href, snippet });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function dispatchToolWebhook(input: {
  envelope: ToolEnvelope;
  actorExternalId: string;
  sessionId: string;
  context: unknown;
  webhookUrl?: string;
  webhookSecret?: string;
  missingConfigReply: string;
  executorLabel: string;
}): Promise<ToolExecutionResult> {
  if (!input.webhookUrl?.trim()) {
    return {
      handled: true,
      userReply: input.missingConfigReply,
      providerNotice: `Tool envelope intercepted but ${input.executorLabel} webhook is not configured.`,
    };
  }
  const { guildId, channelId } = readDiscordRoutingContext(input.context);
  const body = {
    type: input.envelope.type,
    tool: input.envelope.tool,
    args: input.envelope.args ?? {},
    reason: input.envelope.reason ?? "",
    actorExternalId: input.actorExternalId,
    sessionId: input.sessionId,
    context: {
      discord: { guildId: guildId ?? null, channelId: channelId ?? null },
    },
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(input.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.webhookSecret ? { "x-vi-tool-secret": input.webhookSecret } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        handled: true,
        userReply: `I tried to dispatch that ${input.executorLabel} job, but the executor returned an error.`,
        providerNotice: `${input.executorLabel} executor HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`,
      };
    }
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = txt ? (JSON.parse(txt) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    const jobId = parsed && typeof parsed.jobId === "string" ? parsed.jobId : undefined;
    const statusUrl = parsed && typeof parsed.statusUrl === "string" ? parsed.statusUrl : undefined;
    return {
      handled: true,
      userReply: statusUrl
        ? `Queued. I started the ${input.envelope.tool} job${jobId ? ` (id: ${jobId})` : ""}. Track it here: ${statusUrl}`
        : `Queued. I started the ${input.envelope.tool} job${jobId ? ` (id: ${jobId})` : ""}.`,
    };
  } catch (err) {
    return {
      handled: true,
      userReply: `I tried to dispatch that ${input.executorLabel} job, but the executor was unreachable.`,
      providerNotice: `${input.executorLabel} executor dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fallbackWebSearch(envelope: ToolEnvelope): Promise<ToolExecutionResult> {
  const query = typeof envelope.args?.query === "string" ? envelope.args.query.trim() : "";
  if (!query) {
    return {
      handled: true,
      userReply: "I can run web search, but I need a query string.",
      providerNotice: "web.search envelope missing args.query",
    };
  }
  const sources = await fetchDuckDuckGoSources(query, 5);
  if (sources.length === 0) {
    return {
      handled: true,
      userReply: `I searched for "${query}" but couldn't retrieve usable live sources right now.`,
      providerNotice: "web.search fallback returned 0 sources",
    };
  }
  const lines = sources.slice(0, 4).map((s, i) => `${i + 1}. ${s.title}\n${s.url}\n${s.snippet}`);
  return {
    handled: true,
    userReply: [`Live web results for "${query}":`, ...lines].join("\n\n"),
    providerNotice: "web.search handled by built-in fallback executor",
  };
}

export async function maybeExecuteToolEnvelope(input: ToolExecutionInput): Promise<ToolExecutionResult> {
  const envelope = parseToolEnvelope(input.replyText);
  if (!envelope) return { handled: false, userReply: input.replyText };

  if (envelope.tool === "media.generate_image" || envelope.tool === "media.generate_video") {
    return dispatchToolWebhook({
      envelope,
      actorExternalId: input.actorExternalId,
      sessionId: input.sessionId,
      context: input.context,
      webhookUrl: input.mediaWebhookUrl,
      webhookSecret: input.mediaWebhookSecret,
      missingConfigReply:
        "Media generation is available in routing, but no media executor is configured yet. Ask the owner to set `VI_MEDIA_TOOL_WEBHOOK_URL`.",
      executorLabel: "media",
    });
  }

  if (envelope.tool === "web.search" || envelope.tool === "docs.search") {
    if (!input.searchWebhookUrl?.trim()) {
      if (envelope.tool === "web.search") {
        return fallbackWebSearch(envelope);
      }
      return {
        handled: true,
        userReply:
          "I can route docs search, but no docs executor is configured yet. Set `VI_SEARCH_TOOL_WEBHOOK_URL` (or wire a docs-specific executor) to enable repository/doc retrieval.",
        providerNotice: "docs.search intercepted without executor",
      };
    }
    return dispatchToolWebhook({
      envelope,
      actorExternalId: input.actorExternalId,
      sessionId: input.sessionId,
      context: input.context,
      webhookUrl: input.searchWebhookUrl,
      webhookSecret: input.searchWebhookSecret,
      missingConfigReply:
        "Search tooling is available in routing, but no search executor is configured yet. Ask the owner to set `VI_SEARCH_TOOL_WEBHOOK_URL`.",
      executorLabel: "search",
    });
  }

  return {
    handled: true,
    userReply: `I prepared a tool request for \`${envelope.tool}\`, but no executor is registered for that tool yet.`,
    providerNotice: "Tool envelope intercepted with unknown tool.",
  };
}

