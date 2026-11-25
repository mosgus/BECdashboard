import type { MacroDataStatus, MacroGate, MacroVersion } from '../api/client'

const SLOT_COUNT = 15

function parts(iso: string, timeZone: string | undefined, withTime: boolean): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  })
  return Object.fromEntries(formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]))
}

/** "25/11/26" (dd/mm/yy) in `timeZone`, default the browser's. */
export function formatShortDate(iso: string, timeZone?: string): string {
  const p = parts(iso, timeZone, false)
  return `${p.day}/${p.month}/${p.year}`
}

/** "25/11/26 14:05" (24 h) in `timeZone`, default the browser's. */
export function formatDateTime(iso: string, timeZone?: string): string {
  const p = parts(iso, timeZone, true)
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

export function signoffText(version: MacroVersion, timeZone?: string): string {
  return `${version.uploaded_by} uploaded this data on ${formatShortDate(version.uploaded_at, timeZone)}`
}

export function revertText(version: MacroVersion, timeZone?: string): string | null {
  if (version.reverted_by === null || version.reverted_at === null) return null
  return `${version.reverted_by} reverted this on ${formatShortDate(version.reverted_at, timeZone)}`
}

/** Describes the gate the API returned; never decides anything itself. */
export function gateText(gate: MacroGate, timeZone?: string): string {
  if (!gate.allowed) {
    return gate.locked_until === null ? 'Locked' : `Locked until ${formatDateTime(gate.locked_until, timeZone)}`
  }
  if (!gate.opens_window && gate.window_closes_at !== null) {
    return `Corrections open until ${formatDateTime(gate.window_closes_at, timeZone)}`
  }
  return 'Open for upload'
}

/** `dataThrough` is a plain date (YYYY-MM-DD); split it rather than build a Date, which would shift it by zone. */
export function dataThroughText(dataThrough: string | null): string | null {
  if (dataThrough === null) return null
  const [year, month, day] = dataThrough.split('-')
  return `Data through ${day}/${month}/${year.slice(-2)}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function buildStatusText(status: MacroDataStatus, timeZone?: string): string {
  const { last_build: build } = status
  if (build?.status === 'failure') {
    return `The last rebuild failed (${formatDateTime(build.started_at, timeZone)}): ${build.error ?? 'no error message was recorded'}. The page still shows the previous data.`
  }
  if (status.slots_filled < SLOT_COUNT) {
    return `${status.slots_filled} of ${SLOT_COUNT} files uploaded. The page shows the 9 Nov snapshot until all ${SLOT_COUNT} are in.`
  }
  if (status.serving === 'uploads' && status.snapshot_built_at !== null) {
    return `Page built from the uploaded files on ${formatDateTime(status.snapshot_built_at, timeZone)}.`
  }
  return `All ${SLOT_COUNT} files uploaded. The page will rebuild shortly.`
}
