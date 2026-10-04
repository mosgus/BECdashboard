import { describe, expect, it } from 'vitest'
import { presetPreview } from './presetPreview'

const GUNNAR =
  'ticker,weight_pct,shares\nMU,74.1847583834589,\nVOO,10.104829494715357,\nPBR,6.8215124159481295,\nORCL,4.426503750208732,\nSHNY,4.163845785064591,\nXIACF,0.2985501706042959,\nCASH,0,\n'
const BEC = 'ticker,shares\nXLK,184\nXLP,559\nXLV,410\nVEA,300\nMS,833\nSETM,870\nCEG,155\nGLD,113\nCASH,292406.58\n'

describe('presetPreview', () => {
  it('previews the first three weight holdings', () => {
    expect(presetPreview(GUNNAR)).toEqual({ ok: true, lines: ['MU · 74.18%', 'VOO · 10.10%', 'PBR · 6.82%'], more: 3 })
  })

  it('previews the first three share holdings', () => {
    expect(presetPreview(BEC)).toEqual({ ok: true, lines: ['XLK · 184 sh', 'XLP · 559 sh', 'XLV · 410 sh'], more: 5 })
  })

  it('does not add an overflow count when all holdings fit', () => {
    expect(presetPreview('ticker,weight_pct,shares\nAAPL,60,\nMSFT,40,\nCASH,0,\n')).toEqual({
      ok: true,
      lines: ['AAPL · 60.00%', 'MSFT · 40.00%'],
      more: 0,
    })
  })

  it('reports unreadable CSV', () => {
    expect(presetPreview('nonsense')).toEqual({ ok: false, lines: [], more: 0 })
  })
})
