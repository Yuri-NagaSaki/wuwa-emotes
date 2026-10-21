import { describe, expect, test } from 'bun:test'
import { CapSession, MAX_TOKEN_AGE_MS, type CapSessionDeps, type CapStatus } from '#/ui/cap/invisible'

// The background Cap of the account forms and comments (src/ui/cap/invisible.ts) against a scripted
// solver: the token flow, and the phase the account forms' status line shows (CapStatus.tsx).

/** A solve that reports progress before it resolves. */
interface Reporting {
  progress: number[]
  token: string
}

interface Solver {
  calls: number
  /** outcome per call: a token, an error, a promise the test resolves, or progress then a token */
  plan: (string | Error | Promise<string> | Reporting)[]
  solve: CapSessionDeps['solve']
  signals: AbortSignal[]
}

function solver(plan: Solver['plan']): Solver {
  const s: Solver = {
    calls: 0,
    plan,
    signals: [],
    solve: async (signal, onProgress) => {
      s.signals.push(signal)
      const next = s.plan[s.calls++] ?? new Error('unplanned solve')
      if (next instanceof Error) throw next
      if (typeof next === 'object' && 'token' in next) {
        await tick()
        for (const p of next.progress) onProgress(p)
        return next.token
      }
      return next
    },
  }
  return s
}

/** A manual timer: `fire()` runs what is due. */
function fakeTimer() {
  const due: { fn: () => void; ms: number; on: boolean }[] = []
  return {
    due,
    timer: (fn: () => void, ms: number) => {
      const t = { fn, ms, on: true }
      due.push(t)
      return () => {
        t.on = false
      }
    },
    pending: () => due.filter((t) => t.on),
    fire: () => {
      for (const t of due.splice(0)) if (t.on) t.fn()
    },
  }
}

function session(sv: Solver, now = () => 0, extra: Partial<CapSessionDeps> = {}) {
  const statuses: CapStatus[] = []
  const cap = new CapSession({ solve: sv.solve, onStatus: (st) => statuses.push(st), now, ...extra })
  return { cap, statuses }
}

/** The phases reported, consecutive repeats collapsed. */
const phases = (statuses: CapStatus[]) => statuses.map((s) => s.phase).filter((p, i, a) => p !== a[i - 1])

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

  test('a background solve that fails shows as failed, not as a failed submit; submit tries again', async () => {
    const sv = solver([new Error('a'), new Error('b'), 't3'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    await tick()
    expect(sv.calls).toBe(2)
    // the account forms' line says 人机验证没有完成; comments (which read `failed`) still show nothing
    expect(cap.phase).toBe('failed')
    expect(cap.failed).toBe(false)
    expect(statuses.some((s) => s.failed || s.waiting)).toBe(false)
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
    expect(phases(statuses)).toEqual(['solving'])
    cap.dispose()
    expect(sv.signals[0]!.aborted).toBe(true)
    cap.warm()
    cap.retry()
    expect(sv.calls).toBe(1)
    expect(statuses.length).toBe(1)
  })
})

describe("CapSession phase (the account forms' status line)", () => {
  test('idle until warm(), then solving, then ready', async () => {
    let release!: (t: string) => void
    const sv = solver([new Promise<string>((r) => (release = r))])
    const { cap, statuses } = session(sv)
    expect(cap.phase).toBe('idle')
    expect(cap.progress).toBeNull()
    cap.warm()
    expect(cap.phase).toBe('solving')
    release('t1')
    await tick()
    expect(cap.phase).toBe('ready')
    expect(phases(statuses)).toEqual(['solving', 'ready'])
  })

  test('progress comes from the solver; 0 means started, not a position', async () => {
    const sv = solver([{ progress: [0, 12.4, 55, 99.6, 100], token: 't1' }])
    const { cap, statuses } = session(sv)
    cap.warm()
    expect(cap.progress).toBeNull()
    await tick()
    await tick()
    expect(statuses.map((s) => s.progress).filter((p) => p != null)).toEqual([12, 55, 100])
    // ready drops the bar
    expect(cap.phase).toBe('ready')
    expect(cap.progress).toBeNull()
  })

  test('the silent retry starts the bar over', async () => {
    let fail!: (e: Error) => void
    const first = new Promise<string>((_, rej) => (fail = rej))
    const sv = solver([first, { progress: [40], token: 't2' }])
    const { cap, statuses } = session(sv)
    cap.warm()
    fail(new Error('network'))
    await tick()
    await tick()
    await tick()
    expect(cap.phase).toBe('ready')
    expect(phases(statuses)).toEqual(['solving', 'ready'])
    expect(statuses.map((s) => s.progress)).toContain(40)
  })

  test('failed after both tries; retry() solves again: solving, then ready', async () => {
    const sv = solver([new Error('a'), new Error('b'), 't3'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    await tick()
    expect(cap.phase).toBe('failed')
    // focus alone does not start over after a failure
    cap.warm()
    expect(sv.calls).toBe(2)
    cap.retry()
    expect(cap.phase).toBe('solving')
    await tick()
    expect(cap.phase).toBe('ready')
    expect(phases(statuses)).toEqual(['solving', 'failed', 'solving', 'ready'])
    const used: string[] = []
    await cap.run(async (t) => (used.push(t), ok))
    expect(used).toEqual(['t3'])
  })

  test('a submit that gets no token: failed for both views; retry() clears it', async () => {
    const sv = solver([new Error('a'), new Error('b'), 't3'])
    const { cap } = session(sv)
    expect(await cap.run(async () => ok)).toBeNull()
    expect(cap.phase).toBe('failed')
    expect(cap.failed).toBe(true)
    cap.retry()
    expect(cap.failed).toBe(false)
    await tick()
    expect(cap.phase).toBe('ready')
  })

  test('a token spent by a failed submit is solved again: solving shows again', async () => {
    const sv = solver(['t1', 't2'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    expect(cap.phase).toBe('ready')
    const wrong = { error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
    await cap.run(async () => wrong)
    expect(cap.phase).toBe('solving')
    await tick()
    expect(cap.phase).toBe('ready')
    expect(phases(statuses)).toEqual(['solving', 'ready', 'solving', 'ready'])
  })

  test('a token rejected by the server is replaced in the same submit', async () => {
    const sv = solver(['old', 'new'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    const res = await cap.run(async (t) => (t === 'old' ? { error: { code: 'CAPTCHA_INVALID' } } : ok))
    expect(res).toEqual(ok)
    expect(phases(statuses)).toEqual(['solving', 'ready', 'solving', 'ready'])
  })

  test('a successful submit stays ready while the page moves on (never back to solving)', async () => {
    const sv = solver(['t1'])
    const { cap, statuses } = session(sv)
    cap.warm()
    await tick()
    await cap.run(async () => ok)
    await tick()
    expect(cap.phase).toBe('ready')
    expect(phases(statuses)).toEqual(['solving', 'ready'])
    expect(sv.calls).toBe(1)
  })

  test('two rejected tokens in a row: failed', async () => {
    const sv = solver(['a', 'b'])
    const { cap } = session(sv)
    await cap.run(async () => ({ error: { code: 'CAPTCHA_INVALID' } }))
    expect(cap.phase).toBe('failed')
  })

  test('with refresh, a token that gets old unused is solved again (solving, then ready)', async () => {
    let now = 0
    const t = fakeTimer()
    const sv = solver(['t1', 't2'])
    const { cap, statuses } = session(sv, () => now, { refresh: true, timer: t.timer })
    cap.warm()
    await tick()
    expect(t.pending().map((x) => x.ms)).toEqual([MAX_TOKEN_AGE_MS])
    now += MAX_TOKEN_AGE_MS
    t.fire()
    expect(cap.phase).toBe('solving')
    await tick()
    expect(cap.phase).toBe('ready')
    expect(phases(statuses)).toEqual(['solving', 'ready', 'solving', 'ready'])
    const used: string[] = []
    await cap.run(async (tok) => (used.push(tok), ok))
    expect(used).toEqual(['t2'])
  })

  test('with refresh, a spent token cancels its timer', async () => {
    const t = fakeTimer()
    const sv = solver(['t1'])
    const { cap } = session(sv, () => 0, { refresh: true, timer: t.timer })
    cap.warm()
    await tick()
    await cap.run(async () => ok)
    expect(t.pending()).toEqual([])
    t.fire()
    expect(sv.calls).toBe(1)
  })

  test('without refresh nothing is scheduled (comments)', async () => {
    const t = fakeTimer()
    const sv = solver(['t1'])
    const { cap } = session(sv, () => 0, { timer: t.timer })
    cap.warm()
    await tick()
    expect(t.due).toEqual([])
  })

  test('dispose cancels the refresh', async () => {
    const t = fakeTimer()
    const sv = solver(['t1'])
    const { cap } = session(sv, () => 0, { refresh: true, timer: t.timer })
    cap.warm()
    await tick()
    cap.dispose()
    expect(t.pending()).toEqual([])
  })
})
