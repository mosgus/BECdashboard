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
      'MU,73.40490607218531,',
      'ORCL,10.481994524396962,',
      'VOO,10.4075329437956,',
      'PBR,3.1979752499318987,',
      'SHNY,2.2013242930879917,',
      'XIACF,0.30626691660223515,',
      'CASH,0,',
      '',
    ].join('\n'),
  },
]
