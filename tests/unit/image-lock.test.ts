import { describe, expect, test } from 'bun:test'
import { oneImageAtATime } from '../../src/server/media/derive'

describe('oneImageAtATime', () => {
  test('runs work one at a time in call order, and a failure does not block the next', async () => {
    let active = 0
    let peak = 0
    const order: number[] = []
    const job = (n: number, fail = false) =>
      oneImageAtATime(async () => {
        active++
        peak = Math.max(peak, active)
        await Bun.sleep(5)
        order.push(n)
        active--
        if (fail) throw new Error(`job ${n}`)
        return n
      })
    const results = await Promise.allSettled([job(1), job(2, true), job(3), job(4)])
    expect(peak).toBe(1)
    expect(order).toEqual([1, 2, 3, 4])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  })

  test('waiting derive work (high) goes before waiting full renders (low); the running one finishes', async () => {
    let active = 0
    let peak = 0
    const order: string[] = []
    const late: Promise<string>[] = []
    const job = (name: string, priority: 'high' | 'low', during?: () => void) =>
      oneImageAtATime(async () => {
        active++
        peak = Math.max(peak, active)
        during?.()
        await Bun.sleep(5)
        order.push(name)
        active--
        return name
      }, priority)
    // a full render holds the slot; more full renders queue, then previews arrive; one more preview is
    // queued while the first preview runs and still goes before the remaining full renders
    const all = [
      job('full-1', 'low'),
      job('full-2', 'low'),
      job('full-3', 'low'),
      job('derive-1', 'high', () => late.push(job('derive-3', 'high'))),
      job('derive-2', 'high'),
    ]
    expect(await Promise.all(all)).toEqual(['full-1', 'full-2', 'full-3', 'derive-1', 'derive-2'])
    expect(await Promise.all(late)).toEqual(['derive-3'])
    expect(order).toEqual(['full-1', 'derive-1', 'derive-2', 'derive-3', 'full-2', 'full-3'])
    expect(peak).toBe(1)
  })

  test('low priority starts at once when the slot is free; a synchronous throw releases it', async () => {
    const order: string[] = []
    const boom = oneImageAtATime((() => {
      throw new Error('sync')
    }) as () => Promise<never>)
    const full = oneImageAtATime(async () => {
      order.push('full')
      return 1
    }, 'low')
    await expect(boom).rejects.toThrow('sync')
    expect(await full).toBe(1)
    expect(order).toEqual(['full'])
  })
})
