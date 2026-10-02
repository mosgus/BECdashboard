import type { GuideSection } from './capmGuide'

export const MONTE_CARLO_SETTING_TERMS = [
  'Lookback',
  'Model',
  'Horizon',
  'Simulations',
  'Starting value',
] as const

export const MONTE_CARLO_GUIDE: GuideSection[] = [
  {
    heading: 'What this does',
    paragraphs: [
      'Monte Carlo simulates many possible paths for this portfolio’s value by replaying its own past daily returns in random order. The spread of the paths shows how wide the range of outcomes could be over the horizon you choose.',
      'It is a simulation of past behavior, not a forecast. Nothing is applied to the portfolio.',
    ],
    entries: [],
  },
  {
    heading: 'How a path is built',
    paragraphs: [
      'First, the holdings’ daily returns over the lookback are combined into one daily return series for the portfolio at its current weights, as if it were rebalanced back to those weights every day. Cash is part of the weights and earns nothing.',
      'Each path then starts at the starting value and compounds one simulated daily return per trading day until the horizon. A day can lose at most everything, so values never go below zero.',
      'The random draws use a fixed seed (42), so the same settings always give the same result.',
    ],
    entries: [
      { term: 'Bootstrap', text: 'Each simulated day is a real day from the lookback, picked at random with replacement. It keeps the real shape of daily returns, including fat tails and big moves. Each day is picked independently, so streaks and calm or stormy periods are not reproduced.' },
      { term: 'Normal', text: 'Each simulated day is drawn from a bell curve with the same daily mean and volatility as the lookback. Extreme days are rarer than in real markets, so the bands are usually a little narrower than with Bootstrap.' },
    ],
  },
  {
    heading: 'Settings',
    paragraphs: [],
    entries: [
      { term: 'Lookback', text: 'How far back the daily returns that the paths are drawn from go: 1, 3 or 5 years, or a custom start date at least 3 months ago. A longer lookback includes more kinds of markets; a shorter one reflects recent behavior but rests on fewer days.' },
      { term: 'Model', text: 'Bootstrap or Normal. See How a path is built.' },
      { term: 'Horizon', text: 'How far ahead each path runs: 3 months (63 trading days), 6 months (126), 1 year (252) or 2 years (504).' },
      { term: 'Simulations', text: 'How many paths to simulate, from 100 to 10,000. More paths give smoother, more stable percentiles. They don’t make the result more accurate, because every path comes from the same past days.' },
      { term: 'Starting value', text: 'The portfolio value on day 0. It defaults to the holdings at their last close plus cash. If the holdings have no share counts or prices, it is a hypothetical $10,000. Changing it scales every result in proportion; the percentage changes stay the same.' },
    ],
  },
  {
    heading: 'Short history',
    paragraphs: [
      'The simulation needs every holding to have a price on every day it uses. If a holding’s prices start more than a week after the lookback start, the simulation uses only the days from that holding’s first price onward, and a note under the results says so. At least 60 shared daily returns are needed to run.',
    ],
    entries: [],
  },
  {
    heading: 'Reading the results',
    paragraphs: [],
    entries: [
      { term: 'Summary', text: 'The number of paths, the horizon, the starting value and the exact window the returns came from.' },
      { term: 'Chance of ending below the starting value', text: 'The share of paths that finish under the starting value at the horizon.' },
      { term: 'Chart', text: 'The dark band holds the middle half of the paths (25th to 75th percentile) and the light band holds 90% of them (5th to 95th). The line is the median path, and the dashed line is the starting value. A wider fan means more uncertainty.' },
      { term: 'Terminal values', text: 'Where the paths end at the horizon: the 5th, 25th, 75th and 95th percentiles, the median and the mean, each with its change from the starting value. The 5th percentile means 1 path in 20 ended lower.' },
      { term: 'Mean and median', text: 'Compounding stretches the upside, so the mean usually sits a little above the median: a few strong paths pull the average up. Read the median as the typical outcome.' },
      { term: 'Export CSV', text: 'Downloads the percentile paths shown in the chart.' },
    ],
  },
  {
    heading: 'Limits of the model',
    paragraphs: [
      'Every path comes from one window of the past. If that window was unusually calm or unusually strong, the simulation will be too. Try a different lookback to see how much the result depends on it.',
      'Days are drawn independently, so the simulation does not capture momentum, mean reversion, volatility clustering or changes in how the holdings move together.',
      'The weights are held fixed. Taxes, fees, trading costs, deposits and withdrawals are not included.',
    ],
    entries: [],
  },
]
