import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSweepStore } from './sweepStore'

vi.mock('../api/client', () => ({
  getSweepStatus: vi.fn(),
}))
vi.mock('./sharedRequests', () => ({
  clearSharedRequests: vi.fn(),
}))

const INTERVAL_MS = 100
const TIMEOUT_MS = 300

type Status = { active: boolean }

function storeWith(poll: () => Promise<Status>) {
  return createSweepStore({ poll, intervalMs: INTERVAL_MS, timeoutMs: TIMEOUT_MS })
}

/** Resolves the given statuses in order; any call past the end repeats the last one. */
function sequence(statuses: Status[]) {
  const poll = vi.fn<() => Promise<Status>>()
  statuses.forEach((status, i) => {
    if (i === statuses.length - 1) poll.mockResolvedValue(status)
    else poll.mockResolvedValueOnce(status)
  })
  return poll
}

describe('createSweepStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays idle when no sweep is running', async () => {
    const poll = sequence([{ active: false }])
    const store = storeWith(poll)
    const changed = vi.fn()
    const ended = vi.fn()
    store.subscribe(changed)
    store.onEnded(ended)

    store.check()
    await vi.advanceTimersByTimeAsync(1000)

    expect(store.isActive()).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    expect(ended).not.toHaveBeenCalled()
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('reports a sweep that runs and ends', async () => {
    const poll = sequence([{ active: true }, { active: true }, { active: false }])
    const store = storeWith(poll)
    const changed = vi.fn()
    const ended = vi.fn()
    store.subscribe(changed)
    store.onEnded(ended)

    store.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.isActive()).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)

    expect(store.isActive()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('ignores check() while a watch is running', async () => {
    const poll = sequence([{ active: true }, { active: true }, { active: false }])
    const store = storeWith(poll)

    store.check()
    store.check()
    await vi.advanceTimersByTimeAsync(0)
    store.check()
    await vi.advanceTimersByTimeAsync(1000)

    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('starts a new watch when check() is called after one ended', async () => {
    const poll = sequence([{ active: true }, { active: true }, { active: false }])
    const store = storeWith(poll)

    store.check()
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(3)

    store.check()
    await vi.advanceTimersByTimeAsync(0)

    expect(poll).toHaveBeenCalledTimes(4)
  })

  it('goes inactive on timeout without calling onEnded', async () => {
    const poll = sequence([{ active: true }])
    const store = storeWith(poll)
    const ended = vi.fn()
    store.onEnded(ended)

    store.check()
    await vi.advanceTimersByTimeAsync(1000)

    expect(store.isActive()).toBe(false)
    expect(ended).not.toHaveBeenCalled()
  })

  it('does not count a rejected poll as a sweep', async () => {
    const poll = vi
      .fn<() => Promise<Status>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ active: false })
    const store = storeWith(poll)
    const ended = vi.fn()
    store.onEnded(ended)

    store.check()
    await vi.advanceTimersByTimeAsync(1000)

    expect(poll).toHaveBeenCalledTimes(2)
    expect(ended).not.toHaveBeenCalled()
  })

  it('does not call listeners after they unsubscribe', async () => {
    const poll = sequence([{ active: true }, { active: true }, { active: false }])
    const store = storeWith(poll)
    const changed = vi.fn()
    const ended = vi.fn()
    const unsubscribeChanged = store.subscribe(changed)
    const unsubscribeEnded = store.onEnded(ended)
    unsubscribeChanged()
    unsubscribeEnded()

    store.check()
    await vi.advanceTimersByTimeAsync(1000)

    expect(changed).not.toHaveBeenCalled()
    expect(ended).not.toHaveBeenCalled()
  })
})

describe('sweepStore (app-wide instance)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the shared request cache when a watched sweep ends', async () => {
    const { getSweepStatus } = await import('../api/client')
    const { clearSharedRequests } = await import('./sharedRequests')
    const { sweepStore } = await import('./sweepStore')
    vi.mocked(getSweepStatus)
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: false })

    sweepStore.check()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(clearSharedRequests).toHaveBeenCalledTimes(1)
  })
})
