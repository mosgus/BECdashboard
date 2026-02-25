"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchUniverse } from "@/lib/api";
import { UniverseTicker } from "@/types/sprint2";

interface Props {
  value: string;
  onChange: (ticker: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function UniverseTickerPicker({
  value,
  onChange,
  placeholder = "Ticker (from Universe)",
  className = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["universe", "active"],
    queryFn: () => fetchUniverse("", true),
    staleTime: 60_000,
  });

  const allTickers: UniverseTicker[] = data?.tickers ?? [];

  const filtered = value.trim()
    ? allTickers.filter((t) =>
        t.ticker.startsWith(value.toUpperCase().trim())
      )
    : allTickers;

  // Reset cursor when filtered list changes
  useEffect(() => {
    setCursor(0);
  }, [filtered.length]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(ticker: string) {
    onChange(ticker);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[cursor]) handleSelect(filtered[cursor].ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
      />

      {open && !disabled && (
        <ul className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--color-muted)]">
              {value ? "No matching universe tickers" : "No active tickers"}
            </li>
          ) : (
            filtered.map((t, i) => (
              <li
                key={t.ticker}
                onMouseDown={() => handleSelect(t.ticker)}
                onMouseEnter={() => setCursor(i)}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm transition-colors ${
                  i === cursor
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text)] hover:bg-[var(--color-border)]"
                }`}
              >
                <span className="font-medium">{t.ticker}</span>
                {t.name && (
                  <span className={`ml-2 truncate text-xs ${i === cursor ? "text-white/70" : "text-[var(--color-muted)]"}`}>
                    {t.name}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
