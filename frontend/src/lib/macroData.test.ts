import { describe, expect, it } from 'vitest'
import type { MacroBuild, MacroDataStatus, MacroGate, MacroVersion } from '../api/client'
import {
  buildStatusText,
  dataThroughText,
  formatBytes,
  formatDateTime,
  formatShortDate,
  gateText,
  revertText,
  signoffText,
} from './macroData'

const UTC = 'UTC'

const version: MacroVersion = {
  id: 1,
  filename: 'CY1.xlsx',
  size_bytes: 5612,
  data_through: '2026-10-30',
  uploaded_by: 'Gunnar Balch',
  uploaded_at: '2026-11-25T13:05:00Z',
  reverted_by: null,
  reverted_at: null,
  live: true,
}

function status(overrides: Partial<MacroDataStatus>): MacroDataStatus {
  return {
    slots: [],
    slots_filled: 15,
    serving: 'uploads',
    snapshot_built_at: '2026-11-25T14:30:00Z',
    last_build: null,
    prices: { tickers: 0, newest_fetched_at: null },
    ...overrides,
  }
}

describe('date formatting', () => {
  it('formats a short date from both ISO forms the API sends', () => {
    expect(formatShortDate('2026-11-25T13:05:00Z', UTC)).toBe('25/11/26')
    expect(formatShortDate('2026-11-25T13:05:00+00:00', UTC)).toBe('25/11/26')
  })

  it('formats a date and 24 h time from both ISO forms', () => {
    expect(formatDateTime('2026-11-25T13:05:00+00:00', UTC)).toBe('25/11/26 13:05')
    expect(formatDateTime('2026-11-25T13:05:00Z', UTC)).toBe('25/11/26 13:05')
  })

  it('uses the requested time zone', () => {
    expect(formatDateTime('2026-11-25T23:30:00Z', 'Asia/Tokyo')).toBe('26/11/26 08:30')
  })

  it('writes midnight as 00:00, not 24:00', () => {
    expect(formatDateTime('2026-11-25T00:05:00Z', UTC)).toBe('25/11/26 00:05')
  })
})

describe('signoffText and revertText', () => {
  it('signs an upload', () => {
    expect(signoffText(version, UTC)).toBe('Gunnar Balch uploaded this data on 25/11/26')
  })

  it('has no revert text for a version that was not reverted', () => {
    expect(revertText(version, UTC)).toBeNull()
  })

  it('signs a revert', () => {
    const reverted = { ...version, reverted_by: 'Sam', reverted_at: '2026-11-26T09:00:00Z' }
    expect(revertText(reverted, UTC)).toBe('Sam reverted this on 26/11/26')
  })
})

describe('gateText', () => {
  it('says a fresh slot is open', () => {
    const gate: MacroGate = { allowed: true, opens_window: true, window_closes_at: null, locked_until: null }
    expect(gateText(gate, UTC)).toBe('Open for upload')
  })

  it('says when the correction window closes', () => {
    const gate: MacroGate = {
      allowed: true,
      opens_window: false,
      window_closes_at: '2026-11-25T13:00:00Z',
      locked_until: null,
    }
    expect(gateText(gate, UTC)).toBe('Corrections open until 25/11/26 13:00')
  })

  it('says when a locked slot opens again', () => {
    const gate: MacroGate = {
      allowed: false,
      opens_window: false,
      window_closes_at: null,
      locked_until: '2026-11-26T12:00:00+00:00',
    }
    expect(gateText(gate, UTC)).toBe('Locked until 26/11/26 12:00')
  })
})

describe('dataThroughText', () => {
  it('formats a plain date without shifting it', () => {
    expect(dataThroughText('2026-10-30')).toBe('Data through 30/10/26')
  })

  it('returns null with no date', () => {
    expect(dataThroughText(null)).toBeNull()
  })
})

describe('formatBytes', () => {
  it('picks the unit', () => {
    expect(formatBytes(4100000)).toBe('3.9 MB')
    expect(formatBytes(5612)).toBe('5.5 KB')
    expect(formatBytes(900)).toBe('900 B')
  })
})

describe('buildStatusText', () => {
  const failure: MacroBuild = {
    status: 'failure',
    started_at: '2026-11-25T13:05:00Z',
    finished_at: '2026-11-25T13:07:00Z',
    result: null,
    error: 'ValueError: Out of range float values are not JSON compliant',
  }

  it('reports a failed rebuild first, even with all 15 files in', () => {
    expect(buildStatusText(status({ slots_filled: 15, last_build: failure }), UTC)).toBe(
      'The last rebuild failed (25/11/26 13:05): ValueError: Out of range float values are not JSON compliant. The page still shows the previous data.',
    )
  })

  it('counts the files still missing', () => {
    expect(buildStatusText(status({ slots_filled: 7, serving: 'snapshot_file', snapshot_built_at: null }), UTC)).toBe(
      '7 of 15 files uploaded. The page shows the 9 Nov snapshot until all 15 are in.',
    )
  })

  it('says when the page was built from the uploads', () => {
    expect(buildStatusText(status({}), UTC)).toBe('Page built from the uploaded files on 25/11/26 14:30.')
  })

  it('says a rebuild is on its way once all 15 are in', () => {
    expect(buildStatusText(status({ serving: 'snapshot_file', snapshot_built_at: null }), UTC)).toBe(
      'All 15 files uploaded. The page will rebuild shortly.',
    )
  })

  it('ignores a successful last build', () => {
    const success: MacroBuild = { ...failure, status: 'success', result: 'built', error: null }
    expect(buildStatusText(status({ last_build: success }), UTC)).toBe(
      'Page built from the uploaded files on 25/11/26 14:30.',
    )
  })
})
