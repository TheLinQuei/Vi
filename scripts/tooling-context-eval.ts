import { parseViToolingContext } from "../apps/api/src/chat/viTurnContext.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const on = parseViToolingContext({
    vi: {
      tools: { webSearch: true, docsSearch: true, connectors: true, mediaGeneration: true },
      voice: { inputMode: "voice" },
    },
  });
  assert(on.webSearchEnabled, "webSearch should parse true");
  assert(on.docsSearchEnabled, "docsSearch should parse true");
  assert(on.connectorsEnabled, "connectors should parse true");
  assert(on.mediaGenerationEnabled, "mediaGeneration should parse true");
  assert(on.voiceInputMode === "voice", "voice mode should parse voice");

  const off = parseViToolingContext({});
  assert(!off.webSearchEnabled, "default webSearch false");
  assert(off.voiceInputMode === "text", "default voice mode text");

  console.log("- [PASS] Vi tooling context parsing invariants");
}

run();
