"use client";
import { useState } from "react";
import { Info } from "lucide-react";

interface Props {
  text: string;
}

/**
 * Small inline info icon that shows a tooltip on hover.
 * Named InfoTooltip to avoid clash with recharts' Tooltip.
 */
export default function InfoTooltip({ text }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <span
        role="img"
        aria-label="More info"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        tabIndex={0}
        className="ml-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors cursor-help"
      >
        <Info size={13} />
      </span>
      {visible && (
        <span className="absolute left-5 top-0 z-50 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs text-[var(--color-text)] shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
