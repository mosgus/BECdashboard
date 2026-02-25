"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { actor } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");

  // If name already set, skip straight to portfolios
  useEffect(() => {
    if (actor.hasActor()) router.replace("/portfolios");
  }, [router]);

  const canSubmit = displayName.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    actor.set(displayName);
    router.replace("/portfolios");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        {/* Logo / branding */}
        <div className="mb-6 text-center">
          <Image
            src="/logo-login.png"
            alt="Blue Eagle Capital"
            width={80}
            height={80}
            className="mx-auto rounded-full"
            priority
          />
          <h1 className="mt-3 text-xl font-bold text-[var(--color-primary)]">Blue Eagle Capital</h1>
          <p className="text-xs font-medium tracking-widest text-[var(--color-muted)] uppercase mt-0.5">
            Emory Goizueta · Portfolio Dashboard
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Your name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="e.g. Alice Chen"
              autoFocus
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
