"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { login } from "@/lib/api";
import { auth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  // If already logged in, skip straight to the app
  useEffect(() => {
    if (auth.isLoggedIn()) router.replace("/");
  }, [router]);

  const mutation = useMutation({
    mutationFn: () => login({ password, display_name: displayName }),
    onSuccess: (data) => {
      auth.setSession(data.token, data.actor);
      router.replace("/");
    },
  });

  const canSubmit = displayName.trim().length > 0 && password.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        {/* Logo / branding */}
        <div className="mb-6 text-center">
          <div className="text-5xl">🦅</div>
          <h1 className="mt-2 text-xl font-bold text-[var(--color-primary)]">Blue Eagle</h1>
          <p className="text-sm text-[var(--color-muted)]">Portfolio Dashboard</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Your Name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice Chen"
              autoFocus
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Class Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && mutation.mutate()}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          {mutation.error && (
            <p className="text-sm text-[var(--color-negative)]">
              {(mutation.error as Error).message}
            </p>
          )}

          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !canSubmit}
            className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? "Signing in…" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
