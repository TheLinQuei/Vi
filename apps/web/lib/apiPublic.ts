/** Built-time URL for the Vi API (must match Cloud Run / local API). */
export function getPublicApiBaseUrl(): string {
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return envBase && envBase.length > 0 ? envBase.replace(/\/$/, "") : "http://127.0.0.1:3001";
}

/** Detect browsing a deployed site while the bundle still targets localhost. */
export function apiMisconfigurationHint(hostname: string, apiBase: string): string | null {
  const apiLooksLocal = apiBase.includes("127.0.0.1") || apiBase.includes("localhost");
  const pageLooksDeployed = hostname !== "localhost" && hostname !== "127.0.0.1";
  if (apiLooksLocal && pageLooksDeployed) {
    return (
      "This deployment was built without NEXT_PUBLIC_API_BASE_URL (still pointing at localhost). " +
      "Set NEXT_PUBLIC_API_BASE_URL to your Cloud Run API URL, rebuild, and redeploy the web app."
    );
  }
  return null;
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
