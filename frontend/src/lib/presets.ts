export interface Preset {
  /** Stable across renames — used as a React key and, later, a URL parameter. */
  id: string
  /** Becomes the draft's portfolio name. The user can rename it before creating. */
  name: string
  /** One line, shown beside the name. Say what the allocation is, not why it is good. */
  description: string
  /** Canonical Blue Eagle CSV. Parsed with parsePortfolioCsv at selection time. */
  csv: string
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'test-concentrated',
    name: 'Gunnar Preset',
    description: 'Gunnar\'s real and current allocations.',
    csv: [
      'ticker,weight_pct,shares',
      'MU,74.1847583834589,',
      'VOO,10.104829494715357,',
      'PBR,6.8215124159481295,',
      'ORCL,4.426503750208732,',
      'SHNY,4.163845785064591,',
      'XIACF,0.2985501706042959,',
      'CASH,0,',
      '',
    ].join('\n'),
  },
  {
    id: 'bec-2026-09-29',
    name: 'BEC Portfolio',
    description: 'Blue Eagle Capital allocation with 39.73% cash.',
    csv: [
      'ticker,weight_pct,shares',
      'XLK,4.86276115834461,184',
      'XLP,6.216930236540225,559',
      'XLV,9.511285029428004,410',
      'VEA,2.9015145361710593,300',
      'MS,21.817622197498554,833',
      'SETM,3.5073758753493602,870',
      'CEG,5.572296264299137,155',
      'GLD,5.878926011512169,113',
      'CASH,39.73128869085688,',
      '',
    ].join('\n'),
  },
]
