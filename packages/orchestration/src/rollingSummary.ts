import { shouldRunRollingSummaryRefresh } from "@vi/core/memory/rollingSummaryGate";
import {
  countSessionMessages,
  getSessionRollingSummaryFields,
  listSessionMessagesChronological,
  updateSessionRollingSummary,
} from "@vi/db";
import { getProviderAdapter } from "./provider.js";
import { orchEnv } from "./env.js";

const MIN_MESSAGES_FOR_FIRST_SUMMARY = 4;
const REFRESH_AFTER_NEW_MESSAGES = 8;
const TRANSCRIPT_TAIL = 36;
const MAX_SUMMARY_CHARS = 2000;

const SUMMARY_SYSTEM = `You maintain a short rolling summary for an ongoing chat between a user and Vi (the assistant). Output plain text only, max 900 characters.

Bias toward preserving (in this order of priority):
- Important user identity facts shared in-session (name, how they want to be known, concrete details they offered)
- Standing preferences, explicit requests, or boundaries (tone, topics, how Vi should show up)
- Major ongoing thread context (what the conversation is actually about across turns)
- Emotionally meaningful or unresolved context (what landed, what’s still open)

De-prioritize or omit: generic filler, small talk, obvious turn-by-turn chatter, and empty phrasing like “they greeted and asked questions.”

Compress; do not quote long passages. If a prior summary is given, merge and refresh—drop points clearly contradicted by newer messages. Do not invent facts beyond the transcript.`;

function shouldRefreshRollingSummary(
  totalMessages: number,
  summaryMessageCount: number,
  hasSummaryText: boolean,
): boolean {
  if (totalMessages < MIN_MESSAGES_FOR_FIRST_SUMMARY) return false;
  if (!hasSummaryText || summaryMessageCount <= 0) return true;
  return totalMessages - summaryMessageCount >= REFRESH_AFTER_NEW_MESSAGES;
}

/**
 * Bounded refresh after a completed turn (user + assistant rows persisted).
 * Failures are swallowed so chat never breaks.
 */
export async function refreshRollingSessionSummaryIfDue(
  sessionId: string,
  options?: { driftAtTurnStart: number; lastUserMessage: string },
): Promise<void> {
  try {
    const total = await countSessionMessages(sessionId);
    const fields = await getSessionRollingSummaryFields(sessionId);
    if (!fields) return;

    const hasSummaryText = !!(fields.rollingSummary && fields.rollingSummary.trim());
    if (!shouldRefreshRollingSummary(total, fields.summaryMessageCount, hasSummaryText)) {
      return;
    }

    if (
      options !== undefined &&
      !shouldRunRollingSummaryRefresh({
        drift: options.driftAtTurnStart,
        lastUserMessage: options.lastUserMessage,
      })
    ) {
      return;
    }

    const thread = await listSessionMessagesChronological(sessionId);
    const tail = thread.slice(-TRANSCRIPT_TAIL);
    const transcript = tail
      .map((m) => `${m.role === "user" ? "User" : "Vi"}: ${m.content}`)
      .join("\n");

    const adapter = await getProviderAdapter();
    const completion = await adapter.generateReply([
      { role: "system", content: SUMMARY_SYSTEM },
      {
        role: "user",
        content: `Previous summary:\n${hasSummaryText ? fields.rollingSummary : "(none yet)"}\n\nRecent transcript (tail):\n${transcript}\n\nWrite the updated rolling summary.`,
      },
    ], {
      temperature: 0.25,
      maxTokens: 450,
    });
    const text = completion.text.trim();
    if (!text) return;

    const capped = text.slice(0, MAX_SUMMARY_CHARS);
    await updateSessionRollingSummary(sessionId, capped, total);
  } catch (err) {
    if (orchEnv.VI_DEBUG_CONTEXT === "true") {
      console.log("[VI_ROLLING_SUMMARY_ERROR]", err);
    }
  }
}
