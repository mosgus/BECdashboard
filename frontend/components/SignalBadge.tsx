import type { SignalState } from "@/types/sprint2";

interface Props {
  state: SignalState;
  lastDate?: string | null;
  small?: boolean;
}

const CONFIG: Record<SignalState, { label: string; cls: string }> = {
  BULLISH:   { label: "Bullish",    cls: "bg-green-100 text-green-800 border-green-200" },
  BEARISH:   { label: "Bearish",    cls: "bg-red-100 text-red-800 border-red-200" },
  NEUTRAL:   { label: "Neutral",    cls: "bg-gray-100 text-gray-600 border-gray-200" },
  OVERBOUGHT:{ label: "Overbought", cls: "bg-orange-100 text-orange-800 border-orange-200" },
  OVERSOLD:  { label: "Oversold",   cls: "bg-blue-100 text-blue-800 border-blue-200" },
};

export default function SignalBadge({ state, lastDate, small = false }: Props) {
  const { label, cls } = CONFIG[state] ?? CONFIG.NEUTRAL;
  const title = lastDate ? `Last trigger: ${lastDate}` : undefined;

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 font-medium ${
        small ? "py-0.5 text-xs" : "py-1 text-xs"
      } ${cls}`}
    >
      {label}
    </span>
  );
}
