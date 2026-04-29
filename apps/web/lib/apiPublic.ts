/** Built-time URL for the Vi API (must match Cloud Run / local API). */
export function getPublicApiBaseUrl(): string {
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return envBase && envBase.length > 0 ? envBase.replace(/\/$/, "") : "http://127.0.0.1:3001";
}

/** Detect common web/API URL mismatches that manifest as opaque network errors. */
export function apiMisconfigurationHint(hostname: string, apiBase: string): string | null {
  const apiLooksLocal = apiBase.includes("127.0.0.1") || apiBase.includes("localhost");
  const pageLooksDeployed = hostname !== "localhost" && hostname !== "127.0.0.1";
  if (apiLooksLocal && pageLooksDeployed) {
    return (
      "This deployment was built without NEXT_PUBLIC_API_BASE_URL (still pointing at localhost). " +
      "Set NEXT_PUBLIC_API_BASE_URL to your Cloud Run API URL, rebuild, and redeploy the web app."
    );
  }
  const pageIsHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const apiIsHttp = /^http:\/\//i.test(apiBase);
  if (pageIsHttps && apiIsHttp) {
    return (
      "This web app is on HTTPS but NEXT_PUBLIC_API_BASE_URL is HTTP. " +
      "Use an HTTPS API URL (Cloud Run default), rebuild, and redeploy the web app."
    );
  }
  return null;
}

/** Better UX for fetch() failures (CORS/mixed-content/DNS show as generic TypeError). */
export function parseApiNetworkError(err: unknown, apiBase: string): string {
  const message =
    err instanceof Error && typeof err.message === "string" && err.message.trim().length > 0
      ? err.message.trim()
      : "Network request failed.";
  return `${message} Check NEXT_PUBLIC_API_BASE_URL and API CORS. Current API base: ${apiBase}`;
}

/** Prefer JSON error.message; otherwise surface status and body snippet (e.g. HTML proxy errors). */
export async function parseApiErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  if (text) {
    try {
      const json = JSON.parse(text) as { error?: { message?: string } };
      if (typeof json?.error?.message === "string" && json.error.message.length > 0) {
        return json.error.message;
      }
    } catch {
      /* not JSON */
    }
    const trimmed = text.trim().replace(/\s+/g, " ");
    const snippet = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
    return `Request failed (HTTP ${res.status}). ${snippet}`;
  }
  return `Request failed (HTTP ${res.status}).`;
}
