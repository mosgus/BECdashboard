export interface GuideEntry {
  term: string
  text: string
}

export interface GuideSection {
  heading: string
  paragraphs: string[]
  entries: GuideEntry[]
}

export const CAPM_SETTING_TERMS = [
  'Lookback',
  'Risk-free rate',
  'Market risk premium',
  'Market ticker',
  'Target value',
  'Min % / Max %',
  'Freeze',
  'View',
] as const

export const CAPM_GUIDE: GuideSection[] = [
  {
    heading: 'What this does',
    paragraphs: [
      'CAPM optimization chooses Target weights for your invested holdings that give the highest expected Sharpe ratio. The expected returns come from the Capital Asset Pricing Model (CAPM) plus any views you add.',
      'It looks forward: the returns are model assumptions, not a backtest of what happened. Cash is left out and stays as it is.',
    ],
    entries: [],
  },
  {
    heading: 'Expected returns',
    paragraphs: [
      'Each holding’s expected annual return is: risk-free rate + beta × market risk premium + market risk premium × view.',
      'Beta measures how much the holding has moved with the market ticker over the lookback. A beta of 1.0 moves with the market, above 1 amplifies it, and below 1 dampens it. With every view at 0%, a holding’s expected return depends only on its beta.',
    ],
    entries: [],
  },
  {
    heading: 'How the weights are chosen',
    paragraphs: [
      'The optimizer searches for the weights, adding up to 100% of the invested holdings, with the highest (expected return − risk-free rate) ÷ expected volatility.',
      'Volatility and correlations come from the daily returns over the lookback. Every weight stays within its min/max limits, and frozen holdings keep their current weight.',
    ],
    entries: [],
  },
  {
    heading: 'Settings',
    paragraphs: [],
    entries: [
      { term: 'Lookback', text: 'How many years of daily prices are used to estimate betas, volatilities and correlations. Longer lookbacks are steadier but slower to reflect change; shorter ones react faster but are noisier.' },
      { term: 'Risk-free rate', text: 'The annual return on cash-like assets. Leave it blank to use the live 3-month Treasury bill yield. Every expected return and the Sharpe ratio start from it.' },
      { term: 'Market risk premium', text: 'How much more than the risk-free rate you expect the market to return each year (5% by default). At 0%, every holding expects the risk-free rate and views have no effect.' },
      { term: 'Market ticker', text: 'The benchmark that betas are measured against (SPY by default). Its prices must cover the whole lookback.' },
      { term: 'Target value', text: 'The dollar size used for the Trades card and the VaR dollar amounts. It defaults to what the invested holdings are worth now, and changing it does not re-run the model. It is a planning figure: Apply always uses the current invested value.' },
      { term: 'Min % / Max %', text: 'Limits on each holding’s Target weight. “Min % for all” and “Max % for all” copy one pair of limits to every holding that isn’t frozen. Limits that cannot all be met stop the run, and the error says which way to relax them.' },
      { term: 'Freeze', text: 'Keeps the holding at its current weight. The optimizer arranges the other holdings around it.' },
      { term: 'View', text: 'Your opinion of the holding compared with what CAPM implies, from −50% to +100%. The view is scaled by the market risk premium: +50% with a 5% premium adds 2.5 percentage points to that holding’s expected return.' },
    ],
  },
  {
    heading: 'Pinned holdings',
    paragraphs: [
      'A holding whose prices start more than a week after the lookback start is pinned. It keeps its current weight, it isn’t optimized, and its limits and freeze setting don’t apply. The results list any pinned holdings. Choose a shorter lookback to include them.',
    ],
    entries: [],
  },
  {
    heading: 'Reading the results',
    paragraphs: [],
    entries: [
      { term: 'Current and Target', text: 'Expected return, volatility, Sharpe ratio and beta for your weights now and for the Target weights, from the same model. The difference is what the optimizer changes.' },
      { term: 'Value at Risk', text: 'Parametric 95% VaR of the Target weights: one period in 20, the return is expected to be worse than this. It comes from a normal model of returns, which understates the chance of large crashes.' },
      { term: 'Holdings table', text: 'Each holding’s beta, CAPM return, view, expected return and volatility, with its Current and Target weights.' },
      { term: 'Trades', text: 'The shares and dollars to buy or sell to move from the current holdings to the Target weights at the Target value.' },
      { term: 'Chart', text: 'Each holding is plotted by volatility and expected return, along with Current, Target (the star) and the risk-free rate. The dashed line runs from the risk-free rate through the Target, and its slope is the Target’s Sharpe ratio. Mixing the Target with cash moves along that line.' },
      { term: 'Export and Apply', text: 'Export CSV downloads the results. Apply to portfolio saves the Target weights as the portfolio’s holdings, sized to the current invested value, and leaves cash unchanged.' },
    ],
  },
  {
    heading: 'Limits of the model',
    paragraphs: [
      'With no views and wide limits, the Target tends to pile into a few holdings, often those with a high beta relative to their volatility. Use Max % to cap any one holding.',
      'Betas, volatilities and correlations are estimated from the past and change over time. Expected returns are assumptions: a single large view can move most of the portfolio into one holding.',
      'Taxes and trading costs are not considered.',
    ],
    entries: [],
  },
]
