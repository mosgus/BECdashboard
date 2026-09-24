export const INDICATOR_GROUPS = [
  { key: 'ema', label: 'EMA 20/50' },
  { key: 'bollinger', label: 'Bollinger (20, 2σ)' },
  { key: 'donchian', label: 'Donchian (20)' },
  { key: 'adx', label: 'ADX 14' },
  { key: 'stochastic', label: 'Stochastic (14,3)' },
  { key: 'obv', label: 'OBV' },
] as const

export const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  sma_cross: 'Bullish when the 20-day SMA crosses above the 50-day SMA. Bearish when it crosses below.',
  rsi_threshold: 'Overbought above 70 (potential pullback), oversold below 30 (potential rebound).',
  macd_cross: 'Bullish when the MACD line crosses above its signal line. Bearish when below.',
}

export interface GlossaryEntry {
  term: string
  definition: string
  /** Set when this entry documents an INDICATOR_GROUPS toggle, so the two cannot drift apart. */
  indicatorKey?: string
}

export const GLOSSARY: ReadonlyArray<GlossaryEntry> = [
  {
    term: 'SMA (Simple Moving Average)',
    definition:
      'The average closing price over the trailing N days. SMA 20 reacts faster to new closes than SMA 50, and a bullish crossover is the faster average crossing above the slower one.',
  },
  {
    term: 'EMA (Exponential Moving Average)',
    definition:
      'Weights recent closes more heavily than an SMA of the same length, so it turns sooner when price changes direction.',
    indicatorKey: 'ema',
  },
  {
    term: 'RSI (Relative Strength Index)',
    definition:
      'A 0–100 momentum oscillator. Above 70 is overbought, below 30 is oversold, and readings between 30 and 70 are neutral.',
  },
  {
    term: 'MACD',
    definition:
      'The 12-day EMA minus the 26-day EMA. The signal line is the 9-day EMA of that difference, and the histogram is MACD minus signal.',
  },
  {
    term: 'ATR (Average True Range)',
    definition:
      'A 14-day average of true range, a measure of volatility. ATR is not directional — it states how far price has moved, not which way, which is why it is shown as a plain number rather than a bullish or bearish badge.',
  },
  {
    term: 'Bollinger Bands',
    definition:
      'A 20-day SMA plus and minus two standard deviations. Price outside the band suggests a stretch relative to recent volatility, not a direction.',
    indicatorKey: 'bollinger',
  },
  {
    term: 'Donchian Channel',
    definition:
      'The rolling 20-day high and low, with the midpoint plotted between them. A break above the upper edge is a momentum signal.',
    indicatorKey: 'donchian',
  },
  {
    term: 'ADX (Average Directional Index)',
    definition:
      'A 0–100 measure of trend strength. A high ADX does not mean bullish — a strong downtrend scores just as high as a strong uptrend.',
    indicatorKey: 'adx',
  },
  {
    term: 'Stochastic %K / %D',
    definition:
      'Where the close sits within its 14-day range. %K is smoothed over 3 days and %D is a 3-day average of %K. Above 80 is overbought, below 20 is oversold.',
    indicatorKey: 'stochastic',
  },
  {
    term: 'OBV (On-Balance Volume)',
    definition:
      'Cumulative volume, added on up days and subtracted on down days. Divergence from price can precede a reversal.',
    indicatorKey: 'obv',
  },
  {
    term: 'Bullish / Bearish / Neutral',
    definition:
      'Bullish means upward momentum — the fast average above the slow one, or MACD above its signal. Bearish is the reverse. Neutral is neither.',
  },
  {
    term: 'Why a signal can be blank',
    definition:
      'A blank cell is not neutral — it means there is not enough stored history yet to compute that indicator. Neutral is a real reading; blank is the absence of one.',
  },
  {
    term: 'Split adjustment',
    definition:
      'Prices are adjusted by adj_close divided by close, and volume is divided by the same ratio, so a stock split does not appear as a jump in either the price line or OBV.',
  },
  {
    term: 'Where the data comes from',
    definition:
      'Yahoo Finance. Stored bars are refreshed when someone visits, once per window (09:30, 12:00, and 16:00 ET), and are considered stale only when the newest bar predates the last completed trading session. Every indicator is computed on stored closes, so nothing here is real-time.',
  },
]
