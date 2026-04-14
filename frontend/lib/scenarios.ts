// Predefined historical scenario windows for stress testing.
// One-click runs the existing historical_replay endpoint with the window dates.

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  start: string;           // YYYY-MM-DD
  end: string;
  tags: ScenarioTag[];
}

export type ScenarioTag = "crisis" | "recovery" | "rate-shock" | "vol-shock";

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "gfc",
    name: "2008 Global Financial Crisis",
    description: "Lehman collapse through the March 2009 trough. S&P ~−50%.",
    start: "2008-09-01",
    end: "2009-03-09",
    tags: ["crisis"],
  },
  {
    id: "covid",
    name: "2020 COVID Crash",
    description: "Feb high to March trough — fastest bear market in history.",
    start: "2020-02-19",
    end: "2020-03-23",
    tags: ["crisis"],
  },
  {
    id: "covid-recovery",
    name: "2020 COVID Recovery",
    description: "March trough through year-end rally. Tech-led snapback.",
    start: "2020-03-23",
    end: "2020-12-31",
    tags: ["recovery"],
  },
  {
    id: "rate-shock-2022",
    name: "2022 Rate Shock",
    description: "Fed tightening cycle, tech drawdown, 60/40 breakdown.",
    start: "2022-01-01",
    end: "2022-10-14",
    tags: ["rate-shock", "crisis"],
  },
  {
    id: "dot-com",
    name: "Dot-com Bust",
    description: "Nasdaq peak to trough. Multi-year growth unwind.",
    start: "2000-03-24",
    end: "2002-10-09",
    tags: ["crisis"],
  },
  {
    id: "vol-spike-2018",
    name: "Feb 2018 Volmageddon",
    description: "Short-vol blow-up. XIV collapse in a single week.",
    start: "2018-02-01",
    end: "2018-02-14",
    tags: ["vol-shock"],
  },
  {
    id: "euro-debt-2011",
    name: "2011 Euro Debt Crisis",
    description: "US credit downgrade + Greek default fears.",
    start: "2011-07-22",
    end: "2011-10-03",
    tags: ["crisis"],
  },
  {
    id: "q4-2018",
    name: "Q4 2018 Selloff",
    description: "Fed hike + trade war. Worst December since 1931.",
    start: "2018-10-01",
    end: "2018-12-24",
    tags: ["crisis"],
  },
];

// Tag → Tailwind classes for the pill
export const TAG_STYLES: Record<ScenarioTag, string> = {
  "crisis": "bg-red-100 text-red-700",
  "recovery": "bg-green-100 text-green-700",
  "rate-shock": "bg-amber-100 text-amber-700",
  "vol-shock": "bg-blue-100 text-blue-700",
};

/**
 * Match a historical_replay date window to a known preset.
 * Returns the preset if start/end match exactly, else null.
 */
export function getPresetByDates(start?: string, end?: string): ScenarioPreset | null {
  if (!start || !end) return null;
  return SCENARIO_PRESETS.find((p) => p.start === start && p.end === end) ?? null;
}
