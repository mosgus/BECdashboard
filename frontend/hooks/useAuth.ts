"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actor } from "@/lib/auth";

interface AuthState {
  checked: boolean;
  actor: string | null;
  logout: () => void;
}

/**
 * Call at the top of every protected page.
 * - Redirects to /login if no actor name is set.
 * - Returns { checked } — render null until checked is true to avoid flash.
 */
export function useAuth(): AuthState {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!actor.hasActor()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  return {
    checked,
    actor: actor.get(),
    logout: () => {
      actor.clear();
      router.replace("/login");
    },
  };
}
