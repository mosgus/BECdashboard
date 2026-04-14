"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

// Root portfolio page — immediately redirects to the Holdings tab.
export default function PortfolioRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/portfolios/${id}/holdings`);
  }, [router, id]);

  return null;
}
