"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/auth";

interface AuthState {
  checked: boolean;
  actor: string | null;
  token: string | null;
  logout: () => void;
}

/**
 * Call at the top of every protected page.
 * - Redirects to /login if no valid token exists.
 * - Returns { checked } — render null until checked is true to avoid flash.
 */
export function useAuth(): AuthState {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!auth.isLoggedIn()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  return {
    checked,
    actor: auth.getActor(),
    token: auth.getToken(),
    logout: () => {
      auth.clear();
      router.replace("/login");
    },
  };
}
