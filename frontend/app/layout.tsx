import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import Providers from "@/components/Providers";
import AuthNav from "@/components/AuthNav";

export const metadata: Metadata = {
  title: "Blue Eagle Portfolio Dashboard",
  description: "Institutional-grade portfolio analytics, optimization, and alerts",
};

const NAV = [
  { href: "/universe", label: "Universe" },
  { href: "/portfolios", label: "Portfolios" },
  { href: "/watchlists", label: "Watchlists" },
  { href: "/technicals", label: "Technicals" },
  { href: "/alerts", label: "Alerts" },
  { href: "/", label: "Overview" },
  { href: "/optimize", label: "Optimization" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] antialiased">
        <Providers>
          <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
            <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
              <div className="flex h-14 items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Logo slot — replace span with <img src="/logo.svg" /> when branding doc arrives */}
                  <span className="text-xl">🦅</span>
                  <span className="font-bold tracking-tight text-[var(--color-primary)]">
                    Blue Eagle
                  </span>
                  <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
                    Portfolio Dashboard
                  </span>
                </div>

                <nav className="flex items-center gap-1">
                  {NAV.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className="rounded-[var(--radius-btn)] px-3 py-1.5 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
                    >
                      {label}
                    </Link>
                  ))}
                  <AuthNav />
                </nav>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
