"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actor } from "@/lib/auth";

/**
 * Displays the current actor name + "Change name" button in the nav bar.
 * Renders nothing on the server or before hydration.
 */
export default function AuthNav() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(actor.get());
  }, []);

  if (!name) return null;

  return (
    <div className="ml-2 flex items-center gap-2 border-l border-[var(--color-border)] pl-3">
      <span className="hidden text-xs text-[var(--color-muted)] sm:inline">{name}</span>
      <button
        onClick={() => {
          actor.clear();
          router.replace("/login");
        }}
        className="rounded-[var(--radius-btn)] px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
      >
        Change name
      </button>
    </div>
  );
}
