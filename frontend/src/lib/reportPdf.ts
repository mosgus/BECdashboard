import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { AttributionResponse, CompareResponse, PerformanceResponse, RiskResponse } from '../api/client'
import type { DecisionMemo, Recommendation } from './memo'
import { attributionFootnote, attributionSummary, contributionRows, loadingRows } from './attribution'
import { performanceRows, performanceSummary } from './performance'
import { lookbackLabel } from './optimize'
import { compareRows, usableFolds } from './research'
import { riskRows, riskSummary } from './risk'
import { SCORE_DISCLAIMER } from './score'
import type { ResearchScore } from './score'
import { scoreTone } from './overview'
import type { ScoreTone } from './overview'
import { SCORE_GUIDE } from './scoreGuide'

// These fixed colours mirror styles/globals.css's light theme.
const PRIMARY = '#012169'
const TEXT = '#111111'
const MUTED = '#4a5d7a'
const BORDER = '#dde3f0'
export const TONE_HEX: Record<ScoreTone, string> = {
  positive: '#16a34a',
  accent: '#F2A900',
  negative: '#dc2626',
}
const GO = TONE_HEX.positive
const NO_GO = TONE_HEX.negative
const CONDITIONAL = TONE_HEX.accent

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN = 15
const CONTENT_BOTTOM = PAGE_HEIGHT - 22
const FOOTER_TOP = PAGE_HEIGHT - 13

export type ReportSource = 'risk' | 'performance' | 'compare' | 'attribution'

export interface ReportInput {
  portfolioName: string
  generatedOn: string
  holdingsCount: number
  cashPct: number
  score: ResearchScore
  risk: RiskResponse | null
  performance: PerformanceResponse | null
  compare: CompareResponse | null
  attribution: AttributionResponse | null
  errors: Partial<Record<ReportSource, string>>
  memo: DecisionMemo | null
  memoHoldingsChanged: boolean
}

export interface ReportContext {
  doc: jsPDF
  y: number
  text(text: string, x: number, y: number, options?: ParagraphOptions): void
  heading(text: string): void
  subheading(text: string): void
  paragraph(text: string, options?: ParagraphOptions): void
  ensureSpace(height: number): void
  table(head: string[], body: string[][]): void
}

export interface ParagraphOptions {
  fontSize?: number
  fontStyle?: 'normal' | 'bold' | 'italic'
  color?: string
  gapAfter?: number
  align?: 'left' | 'center' | 'right'
}

export interface PdfScoreBar {
  label: string
  fraction: number | null
  fillHex: string | null
  points: string
  detail: string
}

export interface PdfScoreVisual {
  ring: { text: string; strokeHex: string; fillHex: string }
  bars: PdfScoreBar[]
}

export interface ReportSection {
  title: string
  render: (ctx: ReportContext, input: ReportInput) => void
}

const ALLOWED = /[\n\x20-\x7e\u00a0-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/
const WIN_ANSI_REPLACEMENTS: Record<string, string> = {
  '→': 'to',
  '−': '-',
  '≤': '<=',
  '≥': '>=',
  '★': '*',
  '≈': '~',
}

/** Convert app text into characters supported by jsPDF's built-in WinAnsi fonts. */
export function toPdfText(text: string): string {
  const mapped = [...text].map((character) => WIN_ANSI_REPLACEMENTS[character] ?? character).join('')
  return [...mapped].map((character) => (ALLOWED.test(character) ? character : '?')).join('')
}

export function reportFilename(portfolioName: string, generatedOn: string): string {
  return `${portfolioName.replace(/[^A-Za-z0-9_-]/g, '_')}_research_${generatedOn}.pdf`
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]
}

/** Mix `percent`% of a hex colour into white. */
export function tintHex(hex: string, percent: number): string {
  const channels = rgb(hex).map((channel) => Math.round((255 * (100 - percent) + channel * percent) / 100))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** Build the shared tone colours and text for the PDF score graphics. */
export function pdfScoreVisual(score: ResearchScore): PdfScoreVisual {
  const strokeHex = score.total === null ? BORDER : TONE_HEX[scoreTone(score.total / 100)]
  return {
    ring:
      score.total === null
        ? { text: '—', strokeHex: BORDER, fillHex: '#ffffff' }
        : { text: String(Math.round(score.total)), strokeHex, fillHex: tintHex(strokeHex, 10) },
    bars: score.components.map((component) => ({
      label: component.label,
      fraction: component.subscore,
      fillHex: component.subscore === null ? null : TONE_HEX[scoreTone(component.subscore)],
      points:
        component.points === null
          ? `— / ${component.maxPoints}`
          : `${component.points.toFixed(1)} / ${component.maxPoints}`,
      detail: `${component.measured ?? '—'} · ${component.window ?? '—'}`,
    })),
  }
}

function createContext(doc: jsPDF): ReportContext {
  const context: ReportContext = {
    doc,
    y: 15,
    text(text, x, y, options = {}) {
      doc.setFont('helvetica', options.fontStyle ?? 'normal')
      doc.setFontSize(options.fontSize ?? 9)
      doc.setTextColor(...rgb(options.color ?? TEXT))
      doc.text(toPdfText(text), x, y, options.align ? { align: options.align } : undefined)
    },
    heading(text) {
      if (context.y + 30 > CONTENT_BOTTOM) {
        doc.addPage()
        context.y = MARGIN
      }
      context.text(text, MARGIN, context.y + 5, { fontSize: 13, fontStyle: 'bold', color: PRIMARY })
      context.y += 11
    },
    subheading(text) {
      if (context.y + 20 > CONTENT_BOTTOM) {
        doc.addPage()
        context.y = MARGIN
      }
      context.text(text, MARGIN, context.y + 4, { fontSize: 10, fontStyle: 'bold', color: TEXT })
      context.y += 7
    },
    paragraph(text, options = {}) {
      const fontSize = options.fontSize ?? 9
      const lineHeight = fontSize * 0.45
      const maxWidth = PAGE_WIDTH - MARGIN * 2
      doc.setFont('helvetica', options.fontStyle ?? 'normal')
      doc.setFontSize(fontSize)
      const lines = doc.splitTextToSize(toPdfText(text), maxWidth) as string[]
      let offset = 0
      while (offset < lines.length) {
        if (context.y + lineHeight > CONTENT_BOTTOM) {
          doc.addPage()
          context.y = MARGIN
        }
        const available = Math.max(1, Math.floor((CONTENT_BOTTOM - context.y) / lineHeight))
        const chunk = lines.slice(offset, offset + available)
        context.text(chunk.join('\n'), MARGIN, context.y + fontSize * 0.35, options)
        context.y += chunk.length * lineHeight
        offset += chunk.length
      }
      context.y += options.gapAfter ?? 2
    },
    ensureSpace(height) {
      if (context.y + height > CONTENT_BOTTOM) {
        doc.addPage()
        context.y = MARGIN
      }
    },
    table(head, body) {
      context.ensureSpace(20)
      let tableEndY = context.y
      autoTable(doc, {
        startY: context.y,
        head: [head.map(toPdfText)],
        body: body.map((row) => row.map(toPdfText)),
        theme: 'grid',
        margin: { left: MARGIN, right: MARGIN, bottom: 22 },
        rowPageBreak: 'avoid',
        styles: {
          font: 'helvetica',
          fontSize: 8,
          cellPadding: 2,
          textColor: rgb(TEXT),
          lineColor: rgb(BORDER),
          lineWidth: 0.2,
          overflow: 'linebreak',
        },
        headStyles: { fillColor: rgb(PRIMARY), textColor: [255, 255, 255], fontStyle: 'bold' },
        didDrawPage: (data) => {
          if (data.cursor !== null) tableEndY = data.cursor.y
        },
      })
      context.y = tableEndY + 3
    },
  }
  return context
}

function unavailable(ctx: ReportContext, source: ReportSource, input: ReportInput): void {
  ctx.paragraph(`Unavailable: ${input.errors[source] ?? 'not loaded'}`)
}

function formatMetric(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(2)
}

function scoreSection(ctx: ReportContext, input: ReportInput): void {
  const { score } = input
  const visual = pdfScoreVisual(score)
  ctx.ensureSpace(32)
  const centerX = MARGIN + 13
  const centerY = ctx.y + 14
  ctx.doc.setDrawColor(...rgb(visual.ring.strokeHex))
  ctx.doc.setFillColor(...rgb(visual.ring.fillHex))
  ctx.doc.setLineWidth(1.2)
  ctx.doc.circle(centerX, centerY, 13, 'FD')
  ctx.text(visual.ring.text, centerX, centerY + 3.5, {
    fontSize: 20,
    fontStyle: 'bold',
    color: TEXT,
    align: 'center',
  })
  ctx.text('/ 100', centerX, centerY + 8, { fontSize: 8, color: MUTED, align: 'center' })

  const note =
    'Out of 100. Green at 70 or more, amber at 45 or more, red below. The colours are a reading aid, not a recommendation.'
  const noteX = MARGIN + 13 * 2 + 8
  const noteWidth = PAGE_WIDTH - MARGIN - noteX
  ctx.doc.setFont('helvetica', 'normal')
  ctx.doc.setFontSize(8)
  const noteLines = ctx.doc.splitTextToSize(toPdfText(note), noteWidth) as string[]
  const noteY = ctx.y + 12
  ctx.text(noteLines.join('\n'), noteX, noteY, { fontSize: 8, color: MUTED })
  if (score.total === null) {
    const missingNote = `Not scored. Missing: ${score.missing.join(', ')}.`
    const missingLines = ctx.doc.splitTextToSize(toPdfText(missingNote), noteWidth) as string[]
    ctx.text(missingLines.join('\n'), noteX, noteY + noteLines.length * 3.6 + 1.5, { fontSize: 8, color: MUTED })
  }
  ctx.y += 32

  for (const bar of visual.bars) {
    ctx.ensureSpace(15)
    const rowY = ctx.y
    ctx.text(bar.label, MARGIN, rowY + 2.5, { fontSize: 9, fontStyle: 'bold', color: TEXT })
    ctx.text(bar.points, PAGE_WIDTH - MARGIN, rowY + 2.5, {
      fontSize: 9,
      color: TEXT,
      align: 'right',
    })
    ctx.doc.setDrawColor(...rgb(BORDER))
    ctx.doc.setFillColor(...rgb(BORDER))
    ctx.doc.roundedRect(MARGIN, rowY + 3.5, 100, 2.6, 1.3, 1.3, 'F')
    if (bar.fraction !== null && bar.fraction > 0 && bar.fillHex !== null) {
      const fillWidth = 100 * Math.min(1, bar.fraction)
      ctx.doc.setDrawColor(...rgb(bar.fillHex))
      ctx.doc.setFillColor(...rgb(bar.fillHex))
      ctx.doc.roundedRect(MARGIN, rowY + 3.5, fillWidth, 2.6, 1.3, 1.3, 'F')
    }
    ctx.text(bar.detail, MARGIN, rowY + 10, { fontSize: 8, color: MUTED })
    ctx.y += 15
  }
  ctx.paragraph(
    'How each component is scored is explained under "How the score is calculated" at the end of this report.',
    { fontSize: 8, color: MUTED },
  )
  ctx.paragraph(SCORE_DISCLAIMER, { fontSize: 8, color: MUTED })
}

function guideSection(ctx: ReportContext): void {
  for (const section of SCORE_GUIDE) {
    ctx.subheading(section.heading)
    for (const paragraph of section.paragraphs) ctx.paragraph(paragraph)
  }
}

function performanceSection(ctx: ReportContext, input: ReportInput): void {
  const response = input.performance
  if (response === null) return unavailable(ctx, 'performance', input)
  ctx.paragraph(performanceSummary(response))
  ctx.table(
    ['Metric', 'Portfolio', response.market_ticker, 'Difference'],
    performanceRows(response).map((row) => [row.label, row.portfolio, row.benchmark, row.diff]),
  )
}

function riskSection(ctx: ReportContext, input: ReportInput): void {
  const response = input.risk
  if (response === null) return unavailable(ctx, 'risk', input)
  ctx.paragraph(riskSummary(response))
  ctx.paragraph(
    `Portfolio volatility ${(response.portfolio_vol * 100).toFixed(2)}% · beta ${response.portfolio_beta.toFixed(2)} · effective holdings ${response.effective_holdings.toFixed(1)} · top-5 weight ${(response.top5_weight * 100).toFixed(1)}%`,
  )
  ctx.table(
    ['Ticker', 'Weight', 'Volatility', 'Beta', 'Risk share'],
    riskRows(response).map((row) => [
      row.ticker,
      `${(row.weight * 100).toFixed(1)}%`,
      `${(row.vol * 100).toFixed(2)}%`,
      row.beta.toFixed(2),
      row.riskShare === null ? '—' : `${(row.riskShare * 100).toFixed(1)}%`,
    ]),
  )
}

function attributionSection(ctx: ReportContext, input: ReportInput): void {
  const response = input.attribution
  if (response === null) return unavailable(ctx, 'attribution', input)
  ctx.paragraph(attributionSummary(response))
  ctx.table(
    ['Factor', 'Beta', 't'],
    loadingRows(response).map((row) => [row.label, row.betaText, row.tText]),
  )
  ctx.table(
    ['Component', 'Contribution'],
    contributionRows(response).map((row) => [row.label, row.text]),
  )
  ctx.paragraph(attributionFootnote(response), { fontSize: 8, color: MUTED })
}

function winCount(stat: { wins: number; of: number } | null): string {
  return stat === null || stat.of === 0 ? '—' : `${stat.wins}/${stat.of}`
}

function comparisonSection(ctx: ReportContext, input: ReportInput): void {
  const response = input.compare
  if (response === null) return unavailable(ctx, 'compare', input)
  ctx.paragraph(
    `Each optimizer is fit on ${lookbackLabel(response.lookback_days)} of prices and scored on the following year, across ${usableFolds(response)} yearly holdouts.`,
  )
  ctx.table(
    ['Portfolio', 'Mean holdout Sharpe', 'Worst year', 'Beat equal weight', 'Beat current', 'In-sample Sharpe'],
    compareRows(response).map((row) =>
      row.error !== null
        ? [row.label, row.error, '—', '—', '—', '—']
        : [
            row.label,
            formatMetric(row.walkForward.mean),
            formatMetric(row.walkForward.worst),
            winCount(row.walkForward.beatEqual),
            winCount(row.walkForward.beatCurrent),
            formatMetric(row.inSample?.sharpe),
          ],
    ),
  )
}

function recommendationColor(recommendation: Recommendation): string {
  if (recommendation === 'GO') return GO
  if (recommendation === 'NO-GO') return NO_GO
  return CONDITIONAL
}

function memoSection(ctx: ReportContext, input: ReportInput): void {
  const memo = input.memo
  if (memo === null) return ctx.paragraph('No decision memo recorded.')
  ctx.paragraph(memo.recommendation, {
    fontSize: 12,
    fontStyle: 'bold',
    color: recommendationColor(memo.recommendation),
  })
  ctx.paragraph(new Date(memo.createdAt).toLocaleDateString(), { fontSize: 8, color: MUTED })
  if (input.memoHoldingsChanged) ctx.paragraph('Holdings have changed since this memo.', { color: MUTED })
  ctx.subheading('Rationale')
  ctx.paragraph(memo.rationale)
  ctx.subheading('Red flags')
  ctx.paragraph(
    memo.redFlags.length === 0
      ? 'None.'
      : memo.redFlags.map((flag) => `${flag.severity} · ${flag.title} — ${flag.detail}`).join('\n'),
  )
  ctx.subheading('Monitoring plan')
  ctx.paragraph(memo.monitoringPlan || 'None.')
}

export const REPORT_SECTIONS: ReportSection[] = [
  { title: 'Research Score', render: scoreSection },
  { title: 'Performance', render: performanceSection },
  { title: 'Holdings and risk', render: riskSection },
  { title: 'Factor attribution', render: attributionSection },
  { title: 'Optimizer comparison', render: comparisonSection },
  { title: 'Decision memo', render: memoSection },
  { title: 'How the score is calculated', render: guideSection },
]

function footer(ctx: ReportContext, input: ReportInput, pageCount: number): void {
  const { doc } = ctx
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    ctx.text(
      `Blue Eagle Capital · ${input.portfolioName} · generated ${input.generatedOn} · Page ${page} of ${pageCount}`,
      MARGIN,
      FOOTER_TOP,
      { fontSize: 7, color: MUTED },
    )
    ctx.text('For research and educational purposes only. Not investment advice.', MARGIN, FOOTER_TOP + 5, {
      fontSize: 7,
      color: MUTED,
    })
  }
}

export function buildResearchReport(input: ReportInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const context = createContext(doc)
  context.text('Blue Eagle Capital', MARGIN, 19, { fontSize: 20, fontStyle: 'bold', color: PRIMARY })
  context.text('Portfolio Research Report', MARGIN, 26, { fontSize: 10, color: MUTED })
  context.text(input.portfolioName, MARGIN, 35, { fontSize: 14, fontStyle: 'bold' })
  context.text(
    `Generated ${input.generatedOn} · ${input.holdingsCount} holdings · ${input.cashPct.toFixed(1)}% cash`,
    MARGIN,
    42,
  )
  doc.setDrawColor(...rgb(PRIMARY))
  doc.setLineWidth(0.8)
  doc.line(MARGIN, 47, PAGE_WIDTH - MARGIN, 47)

  context.y = 53
  for (const section of REPORT_SECTIONS) {
    context.heading(section.title)
    section.render(context, input)
  }
  footer(context, input, doc.getNumberOfPages())
  return doc
}
