import { orchEnv } from "./env.js";

const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  "cdn.discordapp.com",
  "media.discordapp.net",
  "images-ext-1.discordapp.net",
  "storage.googleapis.com",
  "lh3.googleusercontent.com",
];

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [...DEFAULT_ALLOWED_HOST_SUFFIXES];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isMultimodalImageUrlAllowed(urlStr: string): boolean {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const allow = parseAllowlist(orchEnv.VI_MULTIMODAL_URL_ALLOWLIST);
  return allow.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export type FetchedImagePart = { mimeType: string; base64: string };

/**
 * Fetch an image for Vertex inlineData. SSRF-protected: HTTPS + allowlisted hosts only.
 */
export async function fetchImageAsBase64(urlStr: string): Promise<FetchedImagePart> {
  if (!isMultimodalImageUrlAllowed(urlStr)) {
    throw new Error(`multimodal: URL host not allowlisted (${urlStr.slice(0, 80)})`);
  }
  const maxBytes = orchEnv.VI_MULTIMODAL_FETCH_MAX_BYTES;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(urlStr, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`multimodal: HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes) throw new Error("multimodal: image too large (content-length)");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("multimodal: image too large");
    const ct = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() || "";
    const mimeType =
      ct.startsWith("image/") ? ct : sniffMimeFromMagic(buf) ?? "application/octet-stream";
    if (!mimeType.startsWith("image/") && mimeType !== "application/octet-stream") {
      throw new Error("multimodal: response is not an image");
    }
    return { mimeType: mimeType.startsWith("image/") ? mimeType : "image/png", base64: buf.toString("base64") };
  } finally {
    clearTimeout(t);
  }
}

function sniffMimeFromMagic(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
    return "image/webp";
  return null;
}
