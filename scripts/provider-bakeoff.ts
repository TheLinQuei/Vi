import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PromptEntry = {
  id: string;
  category: string;
  text: string;
};

type PromptFile = {
  version: string;
  prompts: PromptEntry[];
};

type ChatSuccess = {
  reply: string;
  sessionId: string;
};

type ChatError = {
  error: {
    message: string;
  };
};

type ResultEntry = {
  id: string;
  category: string;
  text: string;
  response: string;
  latencyMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  if (message.includes("429")) return true;
  if (message.includes("HPE_UNEXPECTED_CONTENT_LENGTH")) return true;
  if (message.includes("fetch failed")) return true;
  return false;
}

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getTimestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const apiBaseUrl = getArg("apiBaseUrl") ?? process.env.BAKEOFF_API_BASE_URL ?? "http://127.0.0.1:3001";
  const provider = getArg("provider") ?? process.env.VI_PROVIDER ?? "unknown";
  const model = getArg("model") ?? "unknown";
  const promptFilePath =
    getArg("prompts") ?? path.resolve(repoRoot, "eval", "prompts-v1.json");
  const maxRetries = Number(getArg("maxRetries") ?? "4");
  const initialRetryDelayMs = Number(getArg("retryDelayMs") ?? "1500");
  const interPromptDelayMs = Number(getArg("interPromptDelayMs") ?? "400");

  const promptRaw = await readFile(promptFilePath, "utf8");
  const promptFile = JSON.parse(promptRaw) as PromptFile;

  if (!Array.isArray(promptFile.prompts) || promptFile.prompts.length !== 20) {
    throw new Error("Prompt file must contain exactly 20 prompts.");
  }

  const results: ResultEntry[] = [];
  let sessionId: string | null = null;

  for (const prompt of promptFile.prompts) {
    let attempt = 0;
    let latencyMs = 0;
    let success: ChatSuccess | null = null;

    while (attempt <= maxRetries) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${apiBaseUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: prompt.text,
            ...(sessionId ? { sessionId } : {}),
          }),
        });

        latencyMs = Date.now() - startedAt;
        const text = await response.text();
        const data = text ? (JSON.parse(text) as ChatSuccess | ChatError) : null;

        if (!response.ok) {
          const errorMessage =
            data && "error" in data ? data.error.message : `HTTP ${response.status}`;
          throw new Error(`Prompt ${prompt.id} failed: ${errorMessage}`);
        }

        success = data as ChatSuccess;
        break;
      } catch (error) {
        attempt += 1;
        if (attempt > maxRetries || !shouldRetry(error)) {
          throw new Error(
            `Prompt ${prompt.id} failed after ${attempt} attempt(s): ${String(error)}`,
          );
        }
        const retryInMs = initialRetryDelayMs * 2 ** (attempt - 1);
        console.log(
          `[bakeoff] retrying ${prompt.id} in ${retryInMs}ms (${attempt}/${maxRetries})`,
        );
        await sleep(retryInMs);
      }
    }

    if (!success) {
      throw new Error(`Prompt ${prompt.id} failed with no successful response.`);
    }
    sessionId = success.sessionId;
    results.push({
      id: prompt.id,
      category: prompt.category,
      text: prompt.text,
      response: success.reply,
      latencyMs,
    });

    if (interPromptDelayMs > 0) {
      await sleep(interPromptDelayMs);
    }
  }

  if (!sessionId) {
    throw new Error("No sessionId returned from API run.");
  }

  const timestamp = new Date().toISOString();
  const outputDir = path.resolve(repoRoot, "eval", "results");
  const fileName = `${getTimestampForFilename()}-${provider}.json`;
  const outputPath = path.join(outputDir, fileName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        runConfig: {
          provider,
          model,
          timestamp,
          promptVersion: promptFile.version,
          sessionId,
          apiBaseUrl,
          knobs: {
            temperature: getArg("temperature") ?? null,
            topP: getArg("topP") ?? null,
            maxTokens: getArg("maxTokens") ?? null,
          },
        },
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Bake-off run complete: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
