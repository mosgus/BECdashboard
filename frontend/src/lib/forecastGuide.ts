import type { GuideSection } from './capmGuide'
import { FORECAST_MODELS } from './forecast'
export const FORECAST_SETTING_TERMS = ['Lookback', 'Model', 'Horizon', 'Simulations', 'Starting value'] as const
export const FORECAST_GUIDE: GuideSection[] = [
  {
    heading: 'What this does',
    paragraphs: [
      'The forecast simulates many possible paths for this portfolio’s value, like Monte Carlo, but lets volatility depend on how markets have behaved recently. After a calm stretch the bands are narrow; after a turbulent one they widen straight away.',
      'Every model uses the same expected daily return: the average daily return over the lookback. The models differ only in how they forecast volatility. Nothing is applied to the portfolio.',
    ],
    entries: [],
  },
  {
    heading: 'The models',
    paragraphs: [
      'The holdings’ daily returns over the lookback are combined into one series for the portfolio at its current weights, as in Monte Carlo. Each model is fitted to that series, then simulates paths from a fixed seed (42), so the same settings always give the same result.',
    ],
    entries: [
      {
        term: 'EWMA',
        text: 'Exponentially weighted volatility. Each past day counts 6% less than the next one, so the last few weeks dominate. The forecast volatility stays at today’s level for the whole horizon, so after a turbulent month EWMA gives the widest bands.',
      },
      {
        term: 'GARCH',
        text:
          'GARCH(1,1). Volatility starts at today’s level and drifts back toward the lookback average at a speed fitted to this portfolio’s history; ' +
          'the half-life in Fitted parameters says how fast. This is the standard model for volatility that clusters. It needs at least 250 shared daily returns.',
      },
      {
        term: 'ARIMA',
        text:
          'A constant-volatility baseline. It allows for a small day-to-day carry-over in returns, but its volatility is the lookback average throughout, ' +
          'whatever the market is doing now. When ARIMA’s bands are much narrower than GARCH’s or EWMA’s, current conditions are rougher than average, not calmer.',
      },
      {
        term: 'Ensemble',
        text: 'Pools paths from EWMA, GARCH and ARIMA in equal shares, so its bands sit between theirs. If a member can’t be fitted, the ensemble uses the others and a note says so. It needs at least 250 shared daily returns.',
      },
    ],
  },
  {
    heading: 'Settings',
    paragraphs: [],
    entries: [
      {
        term: 'Lookback',
        text: 'The window of daily returns the model is fitted to: 1, 3 or 5 years, or a custom start date at least 3 months ago. It sets the expected return and, for GARCH and ARIMA, the average volatility the forecast settles at. GARCH and Ensemble need about a year.',
      },
      { term: 'Model', text: 'EWMA, GARCH, ARIMA or Ensemble. See The models.' },
      {
        term: 'Horizon',
        text: 'How far ahead each path runs: 3 months (63 trading days), 6 months (126), 1 year (252) or 2 years (504).',
      },
      {
        term: 'Simulations',
        text: 'How many paths to simulate, from 100 to 10,000. More paths give smoother percentiles. They don’t make the model more accurate.',
      },
      {
        term: 'Starting value',
        text: 'The portfolio value on day 0. It defaults to the holdings at their last close plus cash, or a hypothetical $10,000 if the holdings have no share counts or prices. Changing it scales every result in proportion.',
      },
    ],
  },
  {
    heading: 'Short history',
    paragraphs: [
      'Every holding needs a price on every day the model uses. If a holding’s prices start more than a week after the lookback start, the model uses only the days from that holding’s first price onward, ' +
        'and a note under the results says so. EWMA and ARIMA need at least 60 shared daily returns; GARCH and Ensemble need 250.',
    ],
    entries: [],
  },
  {
    heading: 'Reading the results',
    paragraphs: [],
    entries: [
      {
        term: 'Volatility today',
        text: 'The model’s annualized volatility for the next trading day, against the lookback average. A large gap means recent markets have been unusually calm or unusually rough.',
      },
      {
        term: 'Value chart',
        text: 'Grey is the past, scaled so it ends at the starting value. After day 0, the dark band holds the middle half of the paths and the light band 90% of them; the line is the median.',
      },
      {
        term: 'Volatility chart',
        text: 'Grey is the realised volatility over each past 21 trading days. After day 0 the line is the model’s forecast. EWMA and ARIMA forecast a flat line; GARCH curves back toward the dashed lookback average.',
      },
      {
        term: 'Terminal values',
        text: 'Where the paths end at the horizon: the 5th, 25th, 75th and 95th percentiles, the median and the mean, each with its change from the starting value.',
      },
      {
        term: 'Ensemble members',
        text: 'Each member’s own median ending value. A wide spread between them means the choice of model matters for this portfolio.',
      },
      {
        term: 'Fitted parameters',
        text: 'The numbers each model was fitted with. For GARCH, α is how strongly one day’s move raises the next day’s volatility, α + β is how long that lasts, and the half-life is the number of trading days for half of today’s gap to the average to close.',
      },
      { term: 'Export CSV', text: 'Downloads the percentile paths and the forecast volatility for each day shown.' },
    ],
  },
  {
    heading: 'Limits of the models',
    paragraphs: [
      'The expected return is the lookback’s average. After a strong five years every model projects strong growth; the models forecast volatility, not returns.',
      'Daily returns are drawn from a bell curve, so extreme days are rarer than in real markets. The weights are held fixed, and taxes, fees, trading costs, deposits and withdrawals are not included.',
      'These models have not yet been checked against what actually happened. A calibration test is planned.',
    ],
    entries: [],
  },
]
void FORECAST_MODELS
