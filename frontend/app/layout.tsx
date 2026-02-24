import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blue Eagle Portfolio Dashboard",
  description: "Institutional-grade portfolio analytics, optimization, and alerts",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/optimize", label: "Optimization" },
  { href: "/technicals", label: "Technicals" },
  { href: "/alerts", label: "Alerts" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🦅</span>
                <span className="font-bold text-gray-900 tracking-tight">Blue Eagle</span>
                <span className="hidden text-xs text-gray-400 sm:inline">Portfolio Dashboard</span>
              </div>
              <nav className="flex items-center gap-1">
                {NAV.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
