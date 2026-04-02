"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ResearchIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/research/overview");
  }, [router]);
  return null;
}
