import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchSweep } from './sweepWatch'

type Status = { active: boolean }

const options = (poll: () => Promise<Status>, overrides: Partial<Parameters<typeof watchSweep<Status>>[0]> = {}) => ({
  poll,
  isActive: (status: Status) => status.active,
  onFinished: vi.fn(),
  onTimeout: vi.fn(),
  intervalMs: 100,
  timeoutMs: 300,
  ...overrides,
})

describe('watchSweep', () => {
  afterEach(() => vi.useRealTimers())

  it('finishes immediately when the first synchronous poll resolves inactive', async () => {
    vi.useFakeTimers()
    const poll = vi.fn(() => Promise.resolve({ active: false }))
    const watch = options(poll)
    watchSweep(watch)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.runAllTicks()
    expect(watch.onFinished).toHaveBeenCalledWith({ active: false }, 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('updates each poll and finishes on the third inactive response', async () => {
    vi.useFakeTimers()
    const poll = vi
      .fn<() => Promise<Status>>()
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: false })
    const onUpdate = vi.fn()
    const watch = options(poll, { onUpdate })
    watchSweep(watch)
    await vi.advanceTimersByTimeAsync(200)
    expect(watch.onFinished).toHaveBeenCalledWith({ active: false }, 3)
    expect(onUpdate).toHaveBeenCalledTimes(3)
  })

  it('ignores a rejection and finishes on the next inactive response', async () => {
    vi.useFakeTimers()
    const poll = vi.fn<() => Promise<Status>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ active: false })
    const watch = options(poll)
    watchSweep(watch)
    await vi.advanceTimersByTimeAsync(100)
    expect(watch.onFinished).toHaveBeenCalledWith({ active: false }, 2)
    expect(watch.onTimeout).not.toHaveBeenCalled()
  })

  it('times out after four still-active polls', async () => {
    vi.useFakeTimers()
    const poll = vi.fn(() => Promise.resolve({ active: true }))
    const watch = options(poll)
    watchSweep(watch)
    await vi.advanceTimersByTimeAsync(300)
    expect(poll).toHaveBeenCalledTimes(4)
    expect(watch.onTimeout).toHaveBeenCalledTimes(1)
    expect(watch.onFinished).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(4)
  })

  it('cancels a watch after its first active poll', async () => {
    vi.useFakeTimers()
    const poll = vi.fn(() => Promise.resolve({ active: true }))
    const watch = options(poll)
    const cancel = watchSweep(watch)
    await vi.runAllTicks()
    cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(watch.onFinished).not.toHaveBeenCalled()
    expect(watch.onTimeout).not.toHaveBeenCalled()
  })

  it('does not call callbacks when cancelled with its first poll in flight', async () => {
    vi.useFakeTimers()
    let resolve!: (status: Status) => void
    const poll = vi.fn(() => new Promise<Status>((done) => { resolve = done }))
    const onUpdate = vi.fn()
    const watch = options(poll, { onUpdate })
    const cancel = watchSweep(watch)
    cancel()
    resolve({ active: false })
    await vi.runAllTicks()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(watch.onFinished).not.toHaveBeenCalled()
  })
})
