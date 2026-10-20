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
})
