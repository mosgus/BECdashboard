"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { ResearchProvider, useResearch } from "@/components/research/ResearchContext";

const TABS = [
  { slug: "overview",   label: "Overview" },
  { slug: "universe",   label: "Universe Research" },
  { slug: "asset",      label: "Asset Research" },
  { slug: "strategy",   label: "Strategy Research" },
  { slug: "portfolio",  label: "Portfolio Research" },
  { slug: "stress",     label: "Stress & Robustness" },
  { slug: "decision",   label: "Decision Memo" },
];

function ResearchHeader() {
  const { portfolioId, setPortfolioId, portfolioDetail, portfolios } = useResearch();

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Research Suite</h1>
        <select
          value={portfolioId ?? ""}
          onChange={(e) => setPortfolioId(e.target.value)}
          className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        >
          <option value="" disabled>
            Select portfolio...
          </option>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {portfolioDetail && (
        <p className="text-xs text-[var(--color-muted)]">
          {portfolioDetail.positions.length} holding
          {portfolioDetail.positions.length !== 1 ? "s" : ""}
          {portfolioDetail.notional_value
            ? ` · $${portfolioDetail.notional_value.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}`
            : ""}
          {` · Created ${new Date(portfolioDetail.created_at).toLocaleDateString()}`}
        </p>
      )}
    </div>
  );
}

function ResearchTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
      {TABS.map(({ slug, label }) => {
        const href = `/research/${slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={slug}
            href={href}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
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
  );
}

export default function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { checked } = useAuth();
  if (!checked) return null;

  return (
    <ResearchProvider>
      <div className="space-y-5">
        <ResearchHeader />
        <ResearchTabs />
        {children}
      </div>
    </ResearchProvider>
  );
}
