"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { fetchPortfolioDetail } from "@/lib/api";

const TABS = [
  { slug: "holdings",  label: "Holdings"    },
  { slug: "targets",   label: "Backtest"    },
  { slug: "outlook",   label: "Outlook"     },
  { slug: "monitor",   label: "Monitor"     },
  { slug: "risk",      label: "Risk & Perf" },
];

export default function PortfolioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { checked } = useAuth();
  const pathname = usePathname();

  const { data } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: () => fetchPortfolioDetail(id),
    enabled: checked,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5">
      {/* Breadcrumb + persistent header card */}
      <div>
        <Link
          href="/portfolios"
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)]"
        >
          ← Portfolios
        </Link>
        <h1 className="mt-1 text-xl font-bold text-[var(--color-text)]">
          {data?.name ?? "…"}
        </h1>
        <p className="text-xs text-[var(--color-muted)]">
          {data
            ? `${data.positions.length} holding${data.positions.length !== 1 ? "s" : ""}`
            : ""}
          {data?.notional_value
            ? ` · $${data.notional_value.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}`
            : ""}
          {data
            ? ` · Created ${new Date(data.created_at).toLocaleDateString()}`
            : ""}
        </p>
      </div>

      {/* URL-driven tab bar */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map(({ slug, label }) => {
          const href = `/portfolios/${id}/${slug}`;
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={slug}
              href={href}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                active
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
