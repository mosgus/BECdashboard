import type { Metadata } from "next";
import { Outfit, DM_Sans } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import Providers from "@/components/Providers";
import AuthNav from "@/components/AuthNav";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Blue Eagle Capital — Portfolio Dashboard",
  description: "Institutional-grade portfolio analytics, optimization, and alerts · Emory Goizueta MAF",
};

const NAV = [
  { href: "/universe",   label: "Universe" },
  { href: "/portfolios", label: "Portfolios" },
  { href: "/optimize",   label: "Optimization" },
  { href: "/watchlists", label: "Watchlists" },
  { href: "/technicals", label: "Technicals" },
  { href: "/alerts",     label: "Alerts" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${dmSans.variable}`}>
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] antialiased">
        <Providers>
          <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
            <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
              <div className="flex h-14 items-center justify-between">
                <Link href="/portfolios" className="flex items-center gap-2.5">
                  <Image
                    src="/logo-nav.png"
                    alt="Blue Eagle Capital"
                    width={32}
                    height={32}
                    className="rounded-full"
                    priority
                  />
                  <span className="font-bold tracking-tight text-[var(--color-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
                    Blue Eagle Capital
                  </span>
                  <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
                    Portfolio Dashboard
                  </span>
                </Link>

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
