"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const API_BASE_URL = envBase && envBase.length > 0 ? envBase.replace(/\/$/, "") : "http://127.0.0.1:3001";

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
      const res = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Signup failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Signup failed due to network error.");
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
