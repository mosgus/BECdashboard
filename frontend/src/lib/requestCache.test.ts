import { describe, it, expect, vi } from 'vitest'
import { memoizeRequest } from './requestCache'

describe('memoizeRequest', () => {
  it('a. two identical calls in sequence call fetcher once', async () => {
    let t = 0
    const fetcher = vi.fn().mockResolvedValue('result')
    const call = memoizeRequest(fetcher, {
      ttlMs: 10000,
      maxEntries: 10,
      now: () => t,
    })

    const result1 = await call({ a: 1 })
    const result2 = await call({ a: 1 })

    expect(result1).toBe('result')
    expect(result2).toBe('result')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('b. two separately constructed calls with same content call fetcher once', async () => {
    let t = 0
    const fetcher = vi.fn().mockResolvedValue('result')
    const call = memoizeRequest(fetcher, {
      ttlMs: 10000,
      maxEntries: 10,
      now: () => t,
    })

    const result1 = await call({ a: 1, b: [2, 3] })
    const result2 = await call({ a: 1, b: [2, 3] })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result1).toBe('result')
    expect(result2).toBe('result')
  })

  it('c. different requests call fetcher multiple times', async () => {
    let t = 0
    const fetcher = vi.fn().mockResolvedValue('result')
    const call = memoizeRequest(fetcher, {
      ttlMs: 10000,
      maxEntries: 10,
      now: () => t,
    })

    await call({ a: 1 })
    await call({ a: 2 })

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('d. two concurrent calls call fetcher once', async () => {
    let t = 0
    const fetcher = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('result'), 10)))
    const call = memoizeRequest(fetcher, {
      ttlMs: 10000,
      maxEntries: 10,
      now: () => t,
    })

    const [result1, result2] = await Promise.all([call({ a: 1 }), call({ a: 1 })])

    expect(result1).toBe('result')
    expect(result2).toBe('result')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('e. fetcher rejects once then resolves; first call rejects, second resolves', async () => {
    let t = 0
    const fetcher = vi.fn()
    fetcher.mockRejectedValueOnce(new Error('x'))
    fetcher.mockResolvedValueOnce(42)

    const call = memoizeRequest(fetcher, {
      ttlMs: 10000,
      maxEntries: 10,
      now: () => t,
    })

    const error = await call({ a: 1 }).catch((e) => e)
    expect(error).toEqual(new Error('x'))

    const result = await call({ a: 1 })
    expect(result).toBe(42)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('f. TTL expiration: call at t=0, hit at t=999, miss at t=1000', async () => {
    let t = 0
    const fetcher = vi.fn().mockResolvedValue('result')
    const call = memoizeRequest(fetcher, {
      ttlMs: 1000,
      maxEntries: 10,
      now: () => t,
    })

    await call({ a: 1 })
    t = 999
    await call({ a: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    t = 1000
    await call({ a: 1 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('g. eviction: with maxEntries=2, call a,b,c,b,a results in 4 fetcher calls', async () => {
    let t = 0
    const fetcher = vi.fn().mockResolvedValue('result')
    const call = memoizeRequest(fetcher, {
      ttlMs: 10000,
      maxEntries: 2,
      now: () => t,
    })

    await call({ k: 'a' })
    await call({ k: 'b' })
    await call({ k: 'c' }) // Evicts 'a'
    await call({ k: 'b' }) // Hit
    await call({ k: 'a' }) // Miss (was evicted)

    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('h. stale rejection must not remove a newer entry', async () => {
    let t = 0
    let firstRejectFn: ((reason: unknown) => void) = () => {}
    const firstPromise = new Promise<string>((_, reject) => {
      firstRejectFn = reject
    })
    const fetcher = vi.fn()
    fetcher.mockReturnValueOnce(firstPromise)
    fetcher.mockResolvedValueOnce('fresh')

    const call = memoizeRequest(fetcher, {
      ttlMs: 1000,
      maxEntries: 10,
      now: () => t,
    })

    const p1 = call({ k: 1 })
    t = 1000 // Time expired
    const p2 = call({ k: 1 }) // Miss, fetcher called again (2nd time)
    expect(fetcher).toHaveBeenCalledTimes(2)

    // Reject the first promise after the second call is stored
    firstRejectFn(new Error('x'))

    // p1 should reject
    await expect(p1).rejects.toThrow('x')

    // p2 should still resolve to 'fresh'
    const result = await p2
    expect(result).toBe('fresh')
    expect(fetcher).toHaveBeenCalledTimes(2)

    // Call again - should return cached 'fresh'
    const p3 = call({ k: 1 })
    expect(await p3).toBe('fresh')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
