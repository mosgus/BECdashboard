import { describe, it, expect } from 'vitest'
import {
  formatMetric,
  formatTick,
  lowerBound,
  nearest,
  niceTicks,
  quadrantLayout,
  spreadLabels,
  xTicks,
} from './macroScorecard'
import type { QuadrantInput } from './macroScorecard'

// The 2026-11-09 snapshot's quadrant inputs, and the flag / label positions the Python build
// (charts.py quadrant_svg) rendered for them in scorecard.html. The inputs here are rounded to 4
// decimals (as stored), the Python ran on full precision, so positions agree to within a pixel.
const DM: QuadrantInput[] = [
  { name: 'U.S.', macro: 0.6583, market: 0.6957, prev: { '1M': { macro: 0.7558, market: 0.7079 }, '3M': { macro: 0.5179, market: 0.891 } } },
  { name: 'Canada', macro: 0.3188, market: 0.6413, prev: { '1M': { macro: 0.4048, market: 0.5515 }, '3M': { macro: 0.546, market: 0.7508 } } },
  { name: 'U.K.', macro: 0.4718, market: 0.6587, prev: { '1M': { macro: 0.4299, market: 0.6415 }, '3M': { macro: 0.4137, market: 0.7323 } } },
  { name: 'Eurozone', macro: 0.4864, market: 0.5295, prev: { '1M': { macro: 0.5859, market: 0.5374 }, '3M': { macro: 0.4753, market: 0.818 } } },
  { name: 'Germany', macro: 0.4793, market: 0.4589, prev: { '1M': { macro: 0.506, market: 0.4087 }, '3M': { macro: 0.3732, market: 0.641 } } },
  { name: 'France', macro: 0.249, market: 0.4199, prev: { '1M': { macro: 0.4798, market: 0.3712 }, '3M': { macro: 0.429, market: 0.7943 } } },
  { name: 'Japan', macro: 0.6985, market: 0.603, prev: { '1M': { macro: 0.6845, market: 0.7255 }, '3M': { macro: 0.6948, market: 0.8876 } } },
]
const DM_EXPECTED = [
  { flag: [698.9, 171.8], label: [678.9, 175.8, 'end'] },
  { flag: [648.6, 326.6], label: [668.6, 330.6, 'start'] },
  { flag: [664.6, 256.9], label: [664.6, 235.9, 'middle'] },
  { flag: [545.3, 250.2], label: [565.3, 254.2, 'start'] },
  { flag: [480.0, 253.4], label: [480.0, 232.4, 'middle'] },
  { flag: [444.0, 358.4], label: [424.0, 362.4, 'end'] },
  { flag: [613.2, 153.5], label: [593.2, 157.5, 'end'] },
]
const EM: QuadrantInput[] = [
  { name: 'China', macro: 0.4162, market: 0.2549, prev: { '1M': { macro: 0.4946, market: 0.4175 }, '3M': { macro: 0.3129, market: 0.4924 } } },
  { name: 'Brazil', macro: 0.2765, market: 0.3295, prev: { '1M': { macro: 0.2919, market: 0.7605 }, '3M': { macro: 0.4286, market: 0.3643 } } },
  { name: 'South Korea', macro: 0.6916, market: 0.3783, prev: { '1M': { macro: 0.8341, market: 0.6845 }, '3M': { macro: 0.8081, market: 0.8304 } } },
  { name: 'Taiwan', macro: 0.8236, market: 0.6984, prev: { '1M': { macro: 0.9106, market: 0.9514 }, '3M': { macro: 0.8439, market: 0.9771 } } },
]
const EM_EXPECTED = [
  { flag: [291.6, 282.2], label: [271.6, 286.2, 'end'] },
  { flag: [360.5, 345.9], label: [340.5, 349.9, 'end'] },
  { flag: [405.6, 156.6], label: [385.6, 160.6, 'end'] },
  { flag: [701.3, 96.4], label: [701.3, 75.4, 'middle'] },
]

describe('quadrantLayout', () => {
  it.each([
    ['DM', DM, DM_EXPECTED],
    ['EM', EM, EM_EXPECTED],
  ] as const)('reproduces the Python flag and label positions for %s', (_group, points, expected) => {
    const layout = quadrantLayout(points)
    expected.forEach((e, i) => {
      expect(Math.abs(layout.flags[i][0] - e.flag[0])).toBeLessThan(1)
      expect(Math.abs(layout.flags[i][1] - e.flag[1])).toBeLessThan(1)
      expect(Math.abs(layout.labels[i].x - (e.label[0] as number))).toBeLessThan(1)
      expect(Math.abs(layout.labels[i].y - (e.label[1] as number))).toBeLessThan(1)
      expect(layout.labels[i].anchor).toBe(e.label[2])
    })
  })

  it('draws one shift per point per horizon', () => {
    const layout = quadrantLayout(DM)
    expect(Object.keys(layout.shifts)).toEqual(['1M', '3M'])
    expect(layout.shifts['3M'].filter((s) => s !== null)).toHaveLength(7)
  })

  it('skips a horizon value that is missing', () => {
    const points: QuadrantInput[] = [
      { name: 'A', macro: 0.5, market: 0.5, prev: { '1M': { macro: null, market: 0.4 } } },
    ]
    expect(quadrantLayout(points).shifts['1M']).toEqual([null])
  })
})

describe('lowerBound / nearest', () => {
  const a = [10, 20, 30]

  it('finds the insertion point', () => {
    expect(lowerBound(a, 5)).toBe(0)
    expect(lowerBound(a, 20)).toBe(1)
    expect(lowerBound(a, 35)).toBe(3)
  })

  it('picks the closest element, earlier on a tie', () => {
    expect(nearest(a, 24)).toBe(1)
    expect(nearest(a, 26)).toBe(2)
    expect(nearest(a, 25)).toBe(1)
    expect(nearest(a, 99)).toBe(2)
  })
})

describe('niceTicks', () => {
  it('steps by 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(47.3, 56.1, 5)).toEqual([48, 50, 52, 54, 56])
  })
})

describe('xTicks', () => {
  it('labels every second month (Jan, Mar, …) on a one-year range', () => {
    const ticks = xTicks(Date.UTC(2025, 10, 9), Date.UTC(2026, 10, 9))
    expect(ticks.map((t) => t.label)).toEqual(["Jan '26", "Mar '26", "May '26", "Jul '26", "Sep '26", "Nov '26"])
  })

  it('labels whole years on a five-year range', () => {
    const ticks = xTicks(Date.UTC(2021, 10, 9), Date.UTC(2026, 10, 9))
    expect(ticks.map((t) => t.label)).toEqual(['2022', '2023', '2024', '2025', '2026'])
  })
})

describe('formatMetric / formatTick', () => {
  it('signs positive values of signed metrics only', () => {
    expect(formatMetric({ signed: true, decimals: 1, suffix: '%' }, 1.25)).toBe('+1.3%')
    expect(formatMetric({ signed: true, decimals: 1, suffix: '%' }, -1.25)).toBe('-1.3%')
    expect(formatMetric({ signed: false, decimals: 1, suffix: 'x' }, 21.04)).toBe('21.0x')
  })

  it('formats axis ticks like the reference page', () => {
    expect(formatTick({ signed: true, decimals: 1, suffix: '%' }, 2)).toBe('+2%')
    expect(formatTick({ signed: false, decimals: 0, suffix: '%' }, 60)).toBe('60%')
    expect(formatTick({ signed: false, decimals: 1, suffix: '' }, 50)).toBe('50')
  })
})

describe('spreadLabels', () => {
  it('pushes overlapping labels apart and keeps input order', () => {
    expect(spreadLabels([100, 50, 105], 17, 300)).toEqual([100, 50, 117])
  })

  it('pulls labels back above the bottom limit', () => {
    expect(spreadLabels([240, 245], 17, 250)).toEqual([233, 250])
  })
})
