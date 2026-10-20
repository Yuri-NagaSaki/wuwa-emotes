import { describe, expect, test } from 'bun:test'
import { capErrorMessage, type CapVerifyDeps, verifyCapToken } from '#/server/auth/cap'

// verifyCapToken logs at warn level on failures; keep test output quiet.
process.env.LOG_LEVEL ??= 'fatal'

const ENDPOINT = 'https://cap.test/site-key/'

interface Call {
  url: string
  body: unknown
}

function deps(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, over: Partial<CapVerifyDeps> = {}) {
  const calls: Call[] = []
  const d: CapVerifyDeps = {
    endpoint: ENDPOINT,
    secret: 'sk-unit',
    timeoutMs: 1000,
    ...over,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
      return fetchImpl(String(input), init ?? {})
    }) as typeof fetch,
  }
  return { d, calls }
}

describe('verifyCapToken', () => {
  test.each([undefined, null, '', 'x'.repeat(513)])('missing token %#: no request is made', async (token) => {
    const { d, calls } = deps(async () => Response.json({ success: true }))
    expect(await verifyCapToken(token, d)).toEqual({ ok: false, reason: 'missing' })
    expect(calls).toHaveLength(0)
  })

  test('success posts secret + token to <endpoint>/siteverify', async () => {
    const { d, calls } = deps(async () => Response.json({ success: true }))
    expect(await verifyCapToken('tok-1', d)).toEqual({ ok: true })
    expect(calls).toEqual([{ url: 'https://cap.test/site-key/siteverify', body: { secret: 'sk-unit', response: 'tok-1' } }])
  })

  test('endpoint without a trailing slash still targets siteverify under the site key', async () => {
    const { d, calls } = deps(async () => Response.json({ success: true }), { endpoint: 'https://cap.test/site-key' })
    await verifyCapToken('tok', d)
    expect(calls[0]!.url).toBe('https://cap.test/site-key/siteverify')
  })

  test.each([
    ['success false', () => Response.json({ success: false, error: 'invalid' })],
    ['4xx', () => Response.json({ success: false }, { status: 403 })],
    ['no success field', () => Response.json({})],
    ['success as a string', () => Response.json({ success: 'true' })],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
  ])('invalid: %s', async (_name, make) => {
    const { d } = deps(async () => make())
    expect(await verifyCapToken('tok', d)).toEqual({ ok: false, reason: 'invalid' })
  })

  test.each([500, 502, 503])('server error %d is unavailable (fail closed)', async (status) => {
    const { d } = deps(async () => Response.json({ success: true }, { status }))
    expect(await verifyCapToken('tok', d)).toEqual({ ok: false, reason: 'unavailable' })
  })

  test('network error is unavailable', async () => {
    const { d } = deps(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED')
    })
    expect(await verifyCapToken('tok', d)).toEqual({ ok: false, reason: 'unavailable' })
  })

  test('timeout is unavailable', async () => {
    const { d } = deps(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
      { timeoutMs: 30 },
    )
    const started = Date.now()
    expect(await verifyCapToken('tok', d)).toEqual({ ok: false, reason: 'unavailable' })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test.skipIf(!!process.env.CAP_DISABLED)('no secret configured: rejected as unavailable (CAP_DISABLED unset)', async () => {
    const { d, calls } = deps(async () => Response.json({ success: true }), { secret: '' })
    expect(await verifyCapToken('tok', d)).toEqual({ ok: false, reason: 'unavailable' })
    expect(calls).toHaveLength(0)
  })

  test('error messages are user-facing Chinese copy', () => {
    for (const reason of ['missing', 'invalid', 'unavailable'] as const) expect(capErrorMessage(reason)).toMatch(/人机验证/)
  })
})
