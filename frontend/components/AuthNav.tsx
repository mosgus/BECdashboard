"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Displays the current actor name + sign-out button in the nav bar.
 * Renders nothing on the server or before hydration.
 */
export default function AuthNav() {
  const router = useRouter();
  const [actor, setActor] = useState<string | null>(null);

  useEffect(() => {
    setActor(auth.getActor());
  }, []);

  if (!actor) return null;

  return (
    <div className="ml-2 flex items-center gap-2 border-l border-[var(--color-border)] pl-3">
      <span className="hidden text-xs text-[var(--color-muted)] sm:inline">{actor}</span>
      <button
        onClick={() => {
          auth.clear();
          router.replace("/login");
        }}
        className="rounded-[var(--radius-btn)] px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
