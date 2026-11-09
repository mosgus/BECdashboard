import type { GuideSection } from './capmGuide'
import { SCORE_LABELS, SCORE_POINTS } from './score'

export const SCORE_GUIDE: GuideSection[] = [
  {
    heading: 'How the score works',
    paragraphs: [
      'The Research Score adds up four components to a number from 0 to 100. Each component is first scored from 0 to 1, then multiplied by its points: 35, 25, 20 and 20.',
      'It describes how the portfolio is built: how spread out its money is, how spread out its risk is, how volatile it is next to the market, and whether it has held up against a simple equal-weight version of itself. It does not predict returns, and the weights are a judgment call, not fitted to any outcome.',
      "Colours are a reading aid, not a recommendation. The ring and each bar are green at 70% of their maximum or more, amber from 45%, and red below that. The cut-offs are the old app's.",
      "If any component can't be computed, there is no partial score: the page says Not scored and names what is missing.",
    ],
    entries: [],
  },
  {
    heading: `${SCORE_LABELS.diversification} (${SCORE_POINTS.diversification} points)`,
    paragraphs: [
      'Effective holdings is 1 ÷ HHI of the invested money: the number of equal-sized positions the portfolio behaves like. Ten holdings where one is half the money behave like about 3.6.',
      'Points = effective holdings ÷ 20 × 35, capped at 35. Twenty or more effective holdings scores full points; two equal holdings score 3.5; five score 8.75.',
      "It uses the one-year window of Risk & Perf's Health tab. Cash is left out.",
    ],
    entries: [],
  },
  {
    heading: `${SCORE_LABELS.risk_concentration} (${SCORE_POINTS.risk_concentration} points)`,
    paragraphs: [
      "Money and risk are different. A holding's share of the risk is how much of the portfolio's volatility it causes, given its weight, its own volatility and how it moves with everything else. The shares add up to 100%. A volatile holding that moves with the rest carries more risk than money; a steady or offsetting one carries less, and a hedge can be negative.",
      'Only the largest share counts. 10% or less scores full points; 50% or more scores zero; in between, points fall in a straight line, so 30% scores 12.5 and 40% scores 6.25.',
      "Example: a holding that is 35% of the money but the portfolio's most volatile name can drive more than half of its volatility. That scores zero here even if the portfolio as a whole is calm. Risk & Perf's Health tab shows every holding's share.",
    ],
    entries: [],
  },
  {
    heading: `${SCORE_LABELS.volatility} (${SCORE_POINTS.volatility} points)`,
    paragraphs: [
      "The portfolio's annualised volatility divided by SPY's over the same days, using the default one-year window of Risk & Perf's Performance tab. Cash counts as zero-volatility money.",
      "At or below the market's volatility (1.0×) scores full points; twice the market's (2.0×) or more scores zero; in between it falls in a straight line, so 1.5× scores 10.",
      'This row treats lower volatility as better. A deliberately aggressive portfolio loses points here by design.',
    ],
    entries: [],
  },
  {
    heading: `${SCORE_LABELS.robustness} (${SCORE_POINTS.robustness} points)`,
    paragraphs: [
      "Taken from Compare Optimizers. In each of the last four years, the portfolio at today's weights and an equal-weight (1/N) version of the same holdings are compared on that year's Sharpe ratio.",
      'Points = years the portfolio beat equal weight ÷ years that could be tested × 20. Ties count as losses. A year is left out when a holding has too little price history for it.',
      "Comparing against equal weight of the same holdings, rather than against zero, takes the market's good and bad years out of the result: it asks whether the weighting helped, not whether the year was kind.",
    ],
    entries: [],
  },
  {
    heading: 'What is not scored',
    paragraphs: [
      'Sharpe, volatility, drawdown, beta and the largest holding are shown alongside the score for context. Past returns and drawdowns vary a lot from one year to the next and say little about the following year, so they are not scored.',
      "The old app's statistical validation tests are not used. They gave the same answer for almost every stock portfolio.",
    ],
    entries: [],
  },
]
