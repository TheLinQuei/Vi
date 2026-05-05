import { maybeExecuteToolEnvelope } from "../apps/api/src/chat/toolEnvelopeExecutor.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const passthrough = await maybeExecuteToolEnvelope({
    replyText: "normal reply",
    actorExternalId: "owner:test",
    sessionId: "s1",
    context: {},
  });
  assert(!passthrough.handled, "non-envelope should pass through");

  const media = await maybeExecuteToolEnvelope({
    replyText: JSON.stringify({
      type: "TOOL_ENVELOPE",
      tool: "media.generate_image",
      args: { prompt: "a cat" },
    }),
    actorExternalId: "owner:test",
    sessionId: "s1",
    context: { discord: { guildId: "g1", channelId: "c1" } },
  });
  assert(media.handled, "media envelope should be intercepted");
  assert(
    /media generation is available/i.test(media.userReply),
    "missing webhook should return config guidance",
  );

  const web = await maybeExecuteToolEnvelope({
    replyText: JSON.stringify({
      type: "TOOL_ENVELOPE",
      tool: "web.search",
      args: { query: "latest model releases" },
    }),
    actorExternalId: "owner:test",
    sessionId: "s2",
    context: {},
  });
  assert(web.handled, "web.search envelope should be intercepted");
  assert(/live web results|couldn't retrieve usable live sources/i.test(web.userReply), "web.search should use built-in fallback");

  const docs = await maybeExecuteToolEnvelope({
    replyText: JSON.stringify({
      type: "TOOL_ENVELOPE",
      tool: "docs.search",
      args: { query: "adapter contract" },
    }),
    actorExternalId: "owner:test",
    sessionId: "s3",
    context: {},
  });
  assert(docs.handled, "docs.search envelope should be intercepted");
  assert(/no docs executor is configured/i.test(docs.userReply), "docs.search should return guidance fallback");

  console.log("- [PASS] Tool envelope executor invariants");
}

void run();
