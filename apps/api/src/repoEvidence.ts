import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ViRepoEvidenceDebugV1, ViRepoEvidenceItemV1 } from "@vi/shared";

const REPO_QUESTION_PATTERNS: RegExp[] = [
  /\b(code|repo|repository|module|function|class|file|files|api|endpoint|server|tsconfig|script)\b/i,
  /\b(where|how|what)\b.{0,40}\b(in|inside|within)\b.{0,30}\b(code|repo|file)\b/i,
  /\b(show|read|explain|find)\b.{0,30}\b(code|file|module|implementation)\b/i,
  /\b(what changed|can you tell what changed|read your code|skim your code|review your code|upgraded your code|code changed)\b/i,
  /`[^`]+`/,
];

const ROOT_SCAN_DIRS = [
  "packages/core/src",
  "packages/orchestration/src",
  "packages/db/src",
  "apps/api/src",
  "apps/web/app",
  "docs/architecture",
];

const ALLOWED_EXT = new Set([".ts", ".tsx", ".md", ".mjs"]);
const MAX_FILES_READ = 600;
const MAX_EVIDENCE_ITEMS = 4;
const MAX_SNIPPET_CHARS = 360;

type Candidate = {
  filePath: string;
  content: string;
  score: number;
  firstHitIdx: number;
  tokenHits: string[];
  highSignalHits: string[];
  symbolHintHit: boolean;
  pathHintHit: boolean;
  fileTypeBoost: "code" | "docs" | "none";
};

type CachedRepoFile = {
  filePath: string;
  content: string;
};

let repoCorpusCache:
  | {
      fingerprint: string;
      files: CachedRepoFile[];
    }
  | null = null;

export function looksLikeRepoCodeQuestion(message: string): boolean {
  const t = message.trim();
  if (t.length < 4) return false;
  return REPO_QUESTION_PATTERNS.some((re) => re.test(t));
}

function extractTokens(message: string): string[] {
  const words = message.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [];
  const stop = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "in",
    "on",
    "for",
    "to",
    "of",
    "and",
    "or",
    "what",
    "where",
    "how",
    "show",
    "read",
    "find",
    "code",
    "repo",
    "repository",
    "file",
    "files",
    "implemented",
    "implementation",
    "defined",
    "function",
    "module",
    "symbol",
    "does",
    "while",
    "away",
    "output",
    "elapsed",
    "time",
  ]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (w.length < 2 || stop.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 10) break;
  }
  return out;
}

function isHighSignalToken(token: string): boolean {
  return token.length >= 10 || token.includes("_") || token.includes("/") || token.includes(".");
}

function isCodeOrientedQuestion(message: string): boolean {
  if (/`[^`]+`/.test(message)) return true;
  if (/\b(where is|where does|implemented|implementation|defined|definition)\b/i.test(message)) return true;
  if (/\b(function|class|module|symbol|endpoint|api|script|ts|tsx|mjs)\b/i.test(message)) return true;
  if (/[A-Za-z_][A-Za-z0-9_]*\(/.test(message)) return true;
  return false;
}

function extractSymbolHints(message: string): string[] {
  const hints: string[] = [];
  const backticks = message.match(/`([^`]+)`/g) ?? [];
  for (const b of backticks) {
    const inner = b.slice(1, -1).trim();
    if (inner.length > 1) hints.push(inner.toLowerCase());
  }
  const callLike = message.match(/\b[A-Za-z_][A-Za-z0-9_]*\b(?=\()/g) ?? [];
  for (const c of callLike) {
    if (c.length > 1) hints.push(c.toLowerCase());
  }
  return [...new Set(hints)].slice(0, 6);
}

async function walkFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      await walkFiles(full, out);
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (ALLOWED_EXT.has(ext)) out.push(full);
  }
}

async function buildRepoFingerprint(root: string): Promise<string> {
  const allFiles: string[] = [];
  for (const rel of ROOT_SCAN_DIRS) {
    const full = path.join(root, rel);
    try {
      await walkFiles(full, allFiles);
    } catch {
      // skip missing directories
    }
  }
  allFiles.sort();
  const withMeta: string[] = [];
  for (const f of allFiles.slice(0, MAX_FILES_READ)) {
    try {
      const s = await stat(f);
      withMeta.push(`${path.relative(root, f).replace(/\\/g, "/")}|${s.mtimeMs}|${s.size}`);
    } catch {
      // skip
    }
  }
  return withMeta.join("\n");
}

async function loadRepoCorpus(repoRoot: string): Promise<CachedRepoFile[]> {
  const fingerprint = await buildRepoFingerprint(repoRoot);
  if (repoCorpusCache && repoCorpusCache.fingerprint === fingerprint) {
    return repoCorpusCache.files;
  }

  const allFiles: string[] = [];
  for (const rel of ROOT_SCAN_DIRS) {
    const full = path.join(repoRoot, rel);
    try {
      await walkFiles(full, allFiles);
    } catch {
      // skip missing directories
    }
  }

  const files: CachedRepoFile[] = [];
  for (const file of allFiles) {
    if (files.length >= MAX_FILES_READ) break;
    try {
      const content = await readFile(file, "utf8");
      files.push({
        filePath: path.relative(repoRoot, file).replace(/\\/g, "/"),
        content,
      });
    } catch {
      // skip unreadable
    }
  }
  repoCorpusCache = { fingerprint, files };
  return files;
}

function snippetAround(content: string, hitIdx: number): string {
  const center = Math.max(0, hitIdx);
  const start = Math.max(0, center - Math.floor(MAX_SNIPPET_CHARS / 2));
  const end = Math.min(content.length, start + MAX_SNIPPET_CHARS);
  return content
    .slice(start, end)
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function snippetAroundSymbol(content: string, symbol: string | null, fallbackHitIdx: number): string {
  if (!symbol) return snippetAround(content, fallbackHitIdx);
  const lower = content.toLowerCase();
  const idx = lower.indexOf(symbol.toLowerCase());
  if (idx === -1) return snippetAround(content, fallbackHitIdx);

  // Prefer full line around symbol and nearby function/class declaration.
  const before = content.lastIndexOf("\n", Math.max(0, idx - 1));
  const after = content.indexOf("\n", idx);
  const lineStart = before === -1 ? 0 : before + 1;
  const lineEnd = after === -1 ? content.length : after;
  const line = content.slice(lineStart, lineEnd);

  const declarationIdx = Math.max(
    lower.lastIndexOf("function ", idx),
    lower.lastIndexOf("export function ", idx),
    lower.lastIndexOf("const ", idx),
    lower.lastIndexOf("class ", idx),
  );
  const anchor = declarationIdx >= 0 ? declarationIdx : lineStart;
  const s = Math.max(0, anchor - 80);
  const e = Math.min(content.length, Math.max(anchor + MAX_SNIPPET_CHARS, lineEnd + 120));
  const out = content.slice(s, e).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return out.length > MAX_SNIPPET_CHARS ? out.slice(0, MAX_SNIPPET_CHARS).trim() : out;
}

export async function retrieveRepoEvidence(input: {
  repoRoot: string;
  userMessage: string;
}): Promise<ViRepoEvidenceDebugV1> {
  const tokens = extractTokens(input.userMessage);
  if (tokens.length === 0) {
    return { readFilePaths: [], used: [] };
  }
  const highSignalTokens = tokens.filter((t) => isHighSignalToken(t));
  const symbolHints = extractSymbolHints(input.userMessage);
  const codeOriented = isCodeOrientedQuestion(input.userMessage);

  const corpus = await loadRepoCorpus(input.repoRoot);
  const readFilePaths = corpus.map((f) => f.filePath);
  const candidates: Candidate[] = [];

  for (const file of corpus) {
    const content = file.content;
    const lower = content.toLowerCase();
    let score = 0;
    let firstHitIdx = -1;
    let matchedHighSignal = highSignalTokens.length === 0;
    const tokenHits: string[] = [];
    const highSignalHits: string[] = [];
    for (const t of tokens) {
      const idx = lower.indexOf(t);
      if (idx >= 0) {
        tokenHits.push(t);
        const weight = isHighSignalToken(t) ? 6 : 1;
        score += weight;
        if (isHighSignalToken(t)) {
          matchedHighSignal = true;
          highSignalHits.push(t);
        }
        if (firstHitIdx === -1 || idx < firstHitIdx) firstHitIdx = idx;
      }
    }
    if (!matchedHighSignal) {
      continue;
    }
    const pathLower = file.filePath.toLowerCase();
    let pathHintHit = false;
    for (const t of highSignalTokens) {
      if (pathLower.includes(t)) {
        score += 2;
        pathHintHit = true;
      }
    }
    let symbolHintHit = false;
    for (const s of symbolHints) {
      const symIdx = lower.indexOf(s);
      if (symIdx >= 0) {
        score += 12;
        symbolHintHit = true;
        if (firstHitIdx === -1 || symIdx < firstHitIdx) firstHitIdx = symIdx;
      }
      if (pathLower.includes(s)) {
        score += 4;
        pathHintHit = true;
      }
    }

    const ext = path.extname(file.filePath).toLowerCase();
    let fileTypeBoost: "code" | "docs" | "none" = "none";
    const isDoc = ext === ".md";
    if (codeOriented) {
      if (isDoc) {
        score -= 8;
        fileTypeBoost = "docs";
      } else {
        score += 3;
        fileTypeBoost = "code";
      }
    } else if (!codeOriented && isDoc) {
      score += 1;
      fileTypeBoost = "docs";
    }
    if (score > 0 && tokenHits.length > 0) {
      candidates.push({
        filePath: file.filePath,
        content,
        score,
        firstHitIdx,
        tokenHits,
        highSignalHits,
        symbolHintHit,
        pathHintHit,
        fileTypeBoost,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.filePath.length - b.filePath.length);

  const used: ViRepoEvidenceItemV1[] = candidates.slice(0, MAX_EVIDENCE_ITEMS).map((c) => {
    const topSymbol = symbolHints.find((s) => c.content.toLowerCase().includes(s)) ?? null;
    return {
      filePath: c.filePath,
      snippet: snippetAroundSymbol(c.content, topSymbol, c.firstHitIdx),
      relevanceScore: c.score,
      whySelected: {
        tokenHits: c.tokenHits.slice(0, 8),
        highSignalHits: c.highSignalHits.slice(0, 6),
        symbolHintHit: c.symbolHintHit,
        pathHintHit: c.pathHintHit,
        fileTypeBoost: c.fileTypeBoost,
      },
    };
  });

  return { readFilePaths, used };
}

export function buildRepoEvidenceSystemMessage(input: {
  userMessage: string;
  evidenceUsed: ViRepoEvidenceItemV1[];
}): string {
  if (input.evidenceUsed.length === 0) {
    return [
      "Repo evidence retrieval was attempted for this code/repo question.",
      "No relevant repository evidence was found in the bounded scan.",
      "Do not invent repository facts. State uncertainty and ask for a file/path/function hint if needed.",
    ].join("\n");
  }

  const lines = input.evidenceUsed
    .map(
      (e, i) =>
        `[#${i + 1}] path=${e.filePath} score=${e.relevanceScore}` +
        `${e.whySelected ? ` why=${JSON.stringify(e.whySelected)}` : ""}\n${e.snippet}`,
    )
    .join("\n---\n");

  return [
    "Repository evidence pack (bounded retrieval; factual; cite paths when relevant):",
    lines,
    "Answer using this evidence only when it fits the question. If insufficient, say so plainly and do not invent.",
  ].join("\n");
}
