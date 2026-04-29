"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiMisconfigurationHint,
  getPublicApiBaseUrl,
  parseApiNetworkError,
  parseApiErrorMessage,
} from "../../lib/apiPublic";

const API_BASE_URL = getPublicApiBaseUrl();

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const hint = apiMisconfigurationHint(window.location.hostname, API_BASE_URL);
      if (hint) {
        setError(hint);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(await parseApiErrorMessage(res));
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(parseApiNetworkError(err, API_BASE_URL));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 460, margin: "40px auto", padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Sign up</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          style={{ padding: 10, borderRadius: 8, border: "1px solid #334155" }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 chars)"
          required
          minLength={8}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #334155" }}
        />
        <button type="submit" disabled={isLoading} style={{ padding: 10, borderRadius: 8 }}>
          {isLoading ? "Creating account..." : "Create account"}
        </button>
      </form>
      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
