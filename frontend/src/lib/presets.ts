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
    description: 'Blue Eagle Capital holdings as share counts, with $292,406.58 cash.',
    csv: [
      'ticker,shares',
      'XLK,184',
      'XLP,559',
      'XLV,410',
      'VEA,300',
      'MS,833',
      'SETM,870',
      'CEG,155',
      'GLD,113',
      'CASH,292406.58',
      '',
    ].join('\n'),
  },
]
