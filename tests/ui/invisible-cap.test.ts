import { describe, expect, test } from 'bun:test'
import { CapSession, MAX_TOKEN_AGE_MS, type CapStatus } from '#/ui/cap/invisible'

// The invisible Cap of the account forms (src/ui/cap/invisible.ts) against a scripted solver.

interface Solver {
  calls: number
  /** outcome per call: a token, an error, or a promise the test resolves */
  plan: (string | Error | Promise<string>)[]
  solve: (signal: AbortSignal) => Promise<string>
  signals: AbortSignal[]
}

function solver(plan: Solver['plan']): Solver {
  const s: Solver = {
    calls: 0,
    plan,
    signals: [],
    solve: async (signal) => {
      s.signals.push(signal)
      const next = s.plan[s.calls++] ?? new Error('unplanned solve')
      if (next instanceof Error) throw next
      return next
    },
  }
  return s
}

function session(sv: Solver, now = () => 0) {
  const statuses: CapStatus[] = []
  const cap = new CapSession({ solve: sv.solve, onStatus: (st) => statuses.push(st), now })
  return { cap, statuses }
}

const ok = { error: null }
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('CapSession', () => {
  test('a token solved in the background is used without waiting', async () => {
    const sv = solver(['t1'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    const used: string[] = []
    const res = await cap.run(async (t) => (used.push(t), ok))
    expect(res).toEqual(ok)
    expect(used).toEqual(['t1'])
    expect(sv.calls).toBe(1)
    expect(statuses.some((s) => s.waiting)).toBe(false)
  })

  test('submit waits for an unfinished proof of work (waiting) and does not start a second one', async () => {
    let release!: (t: string) => void
    const sv = solver([new Promise<string>((r) => (release = r))])
    const { cap } = session(sv)
    cap.warm()
    const run = cap.run(async () => ok)
    await tick()
    expect(cap.waiting).toBe(true)
    cap.warm()
    expect(sv.calls).toBe(1)
    release('t1')
    await run
    expect(cap.waiting).toBe(false)
    expect(sv.calls).toBe(1)
  })

  test('one failed solve is retried silently', async () => {
    const sv = solver([new Error('network'), 't2'])
    const { cap, statuses } = session(sv)
    const used: string[] = []
    await cap.run(async (t) => (used.push(t), ok))
    expect(used).toEqual(['t2'])
    expect(statuses.some((s) => s.failed)).toBe(false)
  })

  test('two failed solves on submit: failed, no request; the next run starts over', async () => {
    const sv = solver([new Error('a'), new Error('b'), 't3'])
    const { cap } = session(sv)
    let requests = 0
    expect(await cap.run(async () => (requests++, ok))).toBeNull()
    expect(cap.failed).toBe(true)
    expect(cap.waiting).toBe(false)
    expect(requests).toBe(0)
    // focus after a failure does not keep solving in the background
    cap.warm()
    expect(sv.calls).toBe(2)
    // the retry action
    expect(await cap.run(async () => (requests++, ok))).toEqual(ok)
    expect(cap.failed).toBe(false)
    expect(requests).toBe(1)
  })

  test('a background solve that fails stays silent; submit tries again', async () => {
    const sv = solver([new Error('a'), new Error('b'), 't3'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    await tick()
    expect(sv.calls).toBe(2)
    expect(cap.failed).toBe(false)
    expect(statuses).toEqual([])
    const used: string[] = []
    expect(await cap.run(async (t) => (used.push(t), ok))).toEqual(ok)
    expect(used).toEqual(['t3'])
  })

  test('tokens are single-use: a failed request solves the next one right away', async () => {
    const sv = solver(['t1', 't2'])
    const { cap } = session(sv)
    const wrong = { error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
    expect(await cap.run(async () => wrong)).toEqual(wrong)
    await tick()
    expect(sv.calls).toBe(2)
    const used: string[] = []
    await cap.run(async (t) => (used.push(t), ok))
    expect(used).toEqual(['t2'])
  })

  test('a request rejected for its token is sent once more with a fresh token', async () => {
    const sv = solver(['old', 'new'])
    const { cap } = session(sv)
    const used: string[] = []
    const res = await cap.run(async (t) => (used.push(t), t === 'old' ? { error: { code: 'CAPTCHA_INVALID' } } : ok))
    expect(res).toEqual(ok)
    expect(used).toEqual(['old', 'new'])
  })

  test('two rejected tokens in a row: failed', async () => {
    const sv = solver(['a', 'b'])
    const { cap } = session(sv)
    expect(await cap.run(async () => ({ error: { code: 'CAPTCHA_INVALID' } }))).toBeNull()
    expect(cap.failed).toBe(true)
  })

  test('Cap unavailable on the server is a normal error, not retried', async () => {
    const sv = solver(['a', 'b'])
    const { cap } = session(sv)
    const res = await cap.run(async () => ({ error: { code: 'CAPTCHA_UNAVAILABLE' } }))
    expect(res?.error?.code).toBe('CAPTCHA_UNAVAILABLE')
    expect(cap.failed).toBe(false)
  })

  test('an old token is solved again', async () => {
    let now = 0
    const sv = solver(['old', 'new'])
    const { cap } = session(sv, () => now)
    cap.warm()
    await tick()
    now += MAX_TOKEN_AGE_MS + 1
    const used: string[] = []
    await cap.run(async (t) => (used.push(t), ok))
    expect(used).toEqual(['new'])
  })

  test('dispose aborts the running solve and reports nothing more', async () => {
    const sv = solver([new Promise<string>(() => {})])
    const { cap, statuses } = session(sv)
    cap.warm()
    cap.dispose()
    expect(sv.signals[0]!.aborted).toBe(true)
    cap.warm()
    expect(sv.calls).toBe(1)
    expect(statuses).toEqual([])
  })
})
