import { describe, it, expect, vi } from 'vitest'
import { cachedLoader } from './macroStore'

describe('cachedLoader', () => {
  it('invokes load once for two sequential calls', async () => {
    const load = vi.fn().mockResolvedValue(42)
    const loader = cachedLoader(load)

    const result1 = await loader()
    const result2 = await loader()

    expect(result1).toBe(42)
    expect(result2).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('invokes load once for two concurrent calls', async () => {
    const load = vi.fn().mockResolvedValue(42)
    const loader = cachedLoader(load)

    const [result1, result2] = await Promise.all([loader(), loader()])

    expect(result1).toBe(42)
    expect(result2).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries after a rejection', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(42)
    const loader = cachedLoader(load)

    await expect(loader()).rejects.toThrow('x')
    const result = await loader()

    expect(result).toBe(42)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
