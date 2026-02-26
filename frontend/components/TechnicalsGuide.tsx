"use client";
import { X } from "lucide-react";

interface Props {
  onClose: () => void;
}

const INDICATORS = [
  {
    name: "SMA 20 / 50",
    tagline: "Simple Moving Average — plain arithmetic mean over a rolling window.",
    whenToUse:
      "Foundational trend filter. When price is above SMA 50 the trend is broadly bullish; SMA 20 is more responsive to short-term reversals. Golden cross (SMA 20 crosses above SMA 50) is a classic long signal. Works best in trending, not choppy, markets.",
    caveat:
      "Lags the price — it is a trailing indicator. Whipsaws frequently in range-bound markets. Each day has equal weight, so a single large outlier observation can distort the average until it rolls off the window.",
  },
  {
    name: "RSI 14",
    tagline: "Relative Strength Index — momentum oscillator scaled 0–100.",
    whenToUse:
      "Overbought/oversold detection. RSI > 70 warns of exhaustion; RSI < 30 warns of capitulation. In strong trends, use divergence (price makes new highs, RSI does not) for earlier signals. Best paired with a trend filter so you don't fade a strong trend.",
    caveat:
      "Can stay overbought (or oversold) for extended periods during strong trends — shorting every RSI > 70 in a bull market is expensive. The 14-day default is short; smoothing with a longer window reduces false signals but slows response.",
  },
  {
    name: "MACD 12 / 26 / 9",
    tagline: "Moving Average Convergence Divergence — trend-following momentum indicator.",
    whenToUse:
      "Signal-line crossovers (MACD crosses above signal line = bullish) and zero-line crosses are the primary entry triggers. Histogram bars show the velocity of the spread — a bar shrinking toward zero often precedes a crossover. Useful for confirming trend continuation after a retracement.",
    caveat:
      "Lags significantly; suited to medium-term trends, not scalping. In ranging markets the MACD line whipsaws around zero and generates costly false signals. Requires clean trending price action to work reliably.",
  },
  {
    name: "ATR 14",
    tagline: "Average True Range — measures daily price range volatility, not direction.",
    whenToUse:
      "Position sizing and stop placement. A stop set at 2× ATR below entry adapts to the asset's recent volatility. Rising ATR during a breakout confirms expansion; falling ATR during a consolidation signals compression before a potential move.",
    caveat:
      "Pure volatility measure — gives no directional bias. ATR spikes after gaps or earnings events can temporarily inflate stop distances. Chart is not shown directly; it feeds into position-sizing calculations.",
  },
  {
    name: "EMA 20 / 50",
    tagline: "Exponential Moving Average — same logic as SMA but recent bars are weighted higher.",
    whenToUse:
      "Faster than SMA: EMA 20 responds to a reversal roughly 3–4 days sooner than SMA 20. Use EMA for shorter-term entries and SMA for confirming the broader trend. EMA ribbons (multiple periods) can identify regime changes as faster EMAs re-order relative to slower ones.",
    caveat:
      "More noise-prone than SMA — the extra responsiveness cuts both ways. In choppy markets the frequent crossovers generate more false signals than SMA. EMA 50 and SMA 50 diverge most after sharp, sustained moves.",
  },
  {
    name: "Bollinger Bands (20, 2σ)",
    tagline: "Volatility envelope: ±2 standard deviations around a 20-day SMA.",
    whenToUse:
      "Band squeeze (bands narrow) precedes explosive moves — direction is uncertain but a breakout is likely. Price touching the upper band is not inherently overbought; in a trend, the price can 'walk the band'. A failure to reach the upper band in an up-trend (price reverses from the middle band) is an early sign of weakening.",
    caveat:
      "The 2σ threshold is calibrated to contain ~95% of price observations under normality — but equity returns have fat tails, so breakouts occur more often than the model predicts. Bands widen after volatility spikes, making them less useful for stop placement in those periods.",
  },
  {
    name: "ADX 14",
    tagline: "Average Directional Index — quantifies trend strength, not direction.",
    whenToUse:
      "ADX > 25 indicates a trending market worth following with SMA/EMA/MACD signals. ADX < 20 suggests a range-bound environment where oscillators (RSI, Stochastic) are more reliable. Rising ADX confirms a developing trend regardless of direction.",
    caveat:
      "Does not indicate direction — a falling market with ADX > 25 is just as 'trending' as a rising one. ADX lags turning points; it will not spike until the trend has been underway for several days. Always pair with a directional indicator.",
  },
  {
    name: "Donchian Channel (20)",
    tagline: "20-day highest high / lowest low envelope — highlights breakout levels.",
    whenToUse:
      "Classic trend-following filter (Turtle Trading). A close above the upper channel is a breakout buy signal; a close below the lower channel is a breakout sell signal. Mid-line (average of upper/lower) can serve as a mean-reversion target.",
    caveat:
      "Mechanical breakout systems suffer badly in choppy markets — the last 20-day high is constantly being retested and failed. Works best when combined with a volatility or ADX filter to avoid trading during low-range periods.",
  },
  {
    name: "Stochastic (14, 3, 3)",
    tagline: "Oscillator comparing close to recent high-low range, scaled 0–100.",
    whenToUse:
      "Primarily an overbought (>80) / oversold (<20) oscillator for mean-reverting strategies. %K and %D crossovers within the extreme zones are entry signals. Best used in range-bound environments or as a confirmation tool before fading extreme moves.",
    caveat:
      "Like RSI, Stochastic can remain overbought or oversold for long periods in trending markets. Smoothed %D reduces noise but adds lag. The 14-period fast %K is highly sensitive; increase the smoothing period for longer-term signals.",
  },
  {
    name: "On-Balance Volume (OBV)",
    tagline: "Cumulative volume indicator — running total of up-day vs down-day volume.",
    whenToUse:
      "Confirms price moves with volume. OBV making new highs alongside price highs is strong confirmation. OBV diverging from price (price makes a new high but OBV does not) is an early warning of a potential reversal. Also useful to spot accumulation (OBV rising) before a price breakout.",
    caveat:
      "The raw OBV number is meaningless in isolation — only the trend and divergences matter. The indicator is sensitive to one-day volume outliers (e.g. index rebalances, options expiry) that can distort the running sum for weeks.",
  },
];

const INTERPRETATION = [
  {
    label: "Overlay vs. panel indicators",
    text: "EMA, Bollinger Bands, and Donchian Channel are overlays — they appear on the main price chart. ADX, Stochastic, and OBV each render in their own separate panel below the price chart. SMA 20/50 always appears on the price chart; RSI and MACD are always shown in their own panels.",
  },
  {
    label: "Indicator toggle checkboxes",
    text: "The checkboxes above the chart request the selected indicators from the API and merge them into the chart. Toggling a checkbox re-fetches with an updated 'include' parameter — the server computes only what you request, keeping response times short.",
  },
  {
    label: "Indicator Config panel",
    text: "The config panel (right side) persists per-ticker, per-portfolio indicator settings to the database. Enabled indicators here record your preferred configuration for alerts and strategy rules — they are independent of the chart toggle checkboxes.",
  },
  {
    label: "No look-ahead bias",
    text: "All indicators are computed strictly on data available at each point in time — the values at date T use only prices up to and including date T. There is no future data leakage. This matches what live trading would see.",
  },
  {
    label: "Downsampling",
    text: "Series longer than 400 points are downsampled for rendering performance. The downsampling selects evenly-spaced points rather than averaging, so sharp peaks and troughs may be slightly smoothed in very long date ranges.",
  },
];

export default function TechnicalsGuide({ onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className="fixed right-0 top-14 bottom-0 z-50 flex w-[440px] max-w-[95vw] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        role="dialog"
        aria-label="Technicals Guide"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Technicals Guide</h2>
            <p className="text-xs text-[var(--color-muted)]">10 indicators — overlays, oscillators & volume</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close guide"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Indicator cards */}
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Indicators</p>
          {INDICATORS.map((ind) => (
            <div
              key={ind.name}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-sm"
            >
              <p className="mb-1 text-sm font-bold text-[var(--color-primary)]">{ind.name}</p>
              <p className="mb-2 text-xs font-medium text-[var(--color-text)]">{ind.tagline}</p>
              <p className="mb-2 text-xs text-[var(--color-muted)] leading-relaxed">{ind.whenToUse}</p>
              <p className="text-xs italic text-[var(--color-muted)]">⚠ {ind.caveat}</p>
            </div>
          ))}

          {/* Interpretation section */}
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            How to interpret results
          </p>
          {INTERPRETATION.map((item) => (
            <div
              key={item.label}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-sm"
            >
              <p className="mb-1 text-xs font-semibold text-[var(--color-text)]">{item.label}</p>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">{item.text}</p>
            </div>
          ))}

          {/* Footer disclaimer */}
          <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-muted)] leading-relaxed">
            <strong className="text-[var(--color-text)]">Disclaimer:</strong> Technical indicators are
            tools for hypothesis generation, not investment advice. Signals are backward-looking and
            do not guarantee future performance. Always validate indicator-based rules with rigorous
            out-of-sample testing before live trading.
          </div>
        </div>
      </aside>
    </>
  );
}
