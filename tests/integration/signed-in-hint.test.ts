import { authCall, DATABASE_URL, goodToken, mainDatabase, sessionCookie, SITE_URL, signUp, TEST_ENV, withClient } from './setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { createServerEntry, getResponseHeaders } from '@tanstack/react-start/server'
import { createEmailVerificationToken } from 'better-auth/api'
import { getViewer } from '#/server/auth/session'
import { SIGNED_IN_HINT } from '#/shared/signed-in-hint'

// The signed-in hint cookie (src/shared/signed-in-hint.ts) through the real Better Auth instance: it
// follows the session cookie on every endpoint that starts or ends a session, is backfilled for
// sessions from before it existed, and never appears on a response to a request without a session
// cookie (that would make anonymous HTML private).

beforeAll(async () => {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
}, 60_000)

/** The hint's Set-Cookie line on a response, if any (the last one, as the browser would apply). */
function hintLine(headers: Headers): string | undefined {
  return headers.getSetCookie().findLast((c) => c.startsWith(`${SIGNED_IN_HINT}=`))
}

function attrs(line: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of line.split(';').slice(1)) {
    const i = part.indexOf('=')
    out.set((i === -1 ? part : part.slice(0, i)).trim().toLowerCase(), i === -1 ? '' : part.slice(i + 1).trim())
  }
  return out
}

function expectSet(headers: Headers, maxAge: string | null = '2592000') {
  const line = hintLine(headers)
  expect(line).toBeDefined()
  expect(line!.startsWith(`${SIGNED_IN_HINT}=1;`)).toBe(true)
  const a = attrs(line!)
  expect(a.get('path')).toBe('/')
  expect(a.get('samesite')?.toLowerCase()).toBe('lax')
  // the page reads it; it only says "signed in"
  expect(a.has('httponly')).toBe(false)
  // NODE_ENV=test: Better Auth's cookies are not Secure here, and the hint follows them
  expect(a.has('secure')).toBe(false)
  expect(a.get('max-age') ?? null).toBe(maxAge)
}

function expectCleared(headers: Headers) {
  const line = hintLine(headers)
  expect(line).toBeDefined()
  expect(line!.startsWith(`${SIGNED_IN_HINT}=;`)).toBe(true)
  expect(attrs(line!).get('max-age')).toBe('0')
}

const withHint = (cookie: string) => `${cookie}; ${SIGNED_IN_HINT}=1`

describe('sessions start: the hint is set', () => {
  test('sign-up that signs in', async () => {
    const res = await authCall('/sign-up/email', { body: { email: `hint-up-${Date.now()}@test.chaochi`, password: 'correct horse battery staple', name: 'hint' }, cap: goodToken() })
    expect(res.status).toBe(200)
    expectSet(res.headers)
  })

  test('sign-in (remember me: as long as the session cookie)', async () => {
    const u = await signUp('hint-in')
    const res = await authCall('/sign-in/email', { body: { email: u.email, password: u.password }, cap: goodToken() })
    expect(res.status).toBe(200)
    expectSet(res.headers)
  })

  test('sign-in without remember me: a browser-session hint, like the session cookie', async () => {
    const u = await signUp('hint-norem')
    const res = await authCall('/sign-in/email', { body: { email: u.email, password: u.password, rememberMe: false }, cap: goodToken() })
    expect(res.status).toBe(200)
    expectSet(res.headers, null)
  })

  test('a failed sign-in sets nothing', async () => {
    const u = await signUp('hint-bad')
    const res = await authCall('/sign-in/email', { body: { email: u.email, password: 'wrong password 123' }, cap: goodToken() })
    expect(res.status).toBe(401)
    expect(hintLine(res.headers)).toBeUndefined()
  })

  test('the verification link signs in (autoSignInAfterVerification)', async () => {
    const u = await signUp('hint-verify')
    const token = await createEmailVerificationToken(TEST_ENV.AUTH_SECRET!, u.email)
    const res = await authCall(`/verify-email?token=${encodeURIComponent(token)}&callbackURL=/verify-email`)
    expect(res.status).toBe(302)
    expect(sessionCookie(res)).toBeTruthy()
    expectSet(res.headers)
  })

  test('模拟登录 and 结束模拟', async () => {
    const owner = await signUp('hint-owner')
    await withClient(DATABASE_URL, (c) => c.query(`update users set role = 'admin' where id = $1`, [owner.id]))
    const target = await signUp('hint-target')
    const start = await authCall('/admin/impersonate-user', { body: { userId: target.id }, cookie: owner.cookie })
    expect(start.status).toBe(200)
    // Better Auth expires the 站长's cookie, then sets the impersonation one without Max-Age (the last
    // entry wins): a browser-session hint, like that cookie
    expectSet(start.headers, null)
    const jar = start.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .filter((p) => /^better-auth\.(session_token|admin_session)=./.test(p))
      .join('; ')
    const stop = await authCall('/admin/stop-impersonating', { body: {}, cookie: withHint(jar) })
    expect(stop.status).toBe(200)
    expectSet(stop.headers)
  })
})

describe('sessions end: the hint is cleared', () => {
  test('sign-out', async () => {
    const u = await signUp('hint-out')
    const res = await authCall('/sign-out', { body: {}, cookie: withHint(u.cookie) })
    expect(res.status).toBe(200)
    expectCleared(res.headers)
  })

  test('a session cookie whose session is gone', async () => {
    const u = await signUp('hint-gone')
    await withClient(DATABASE_URL, (c) => c.query(`delete from sessions where user_id = $1`, [u.id]))
    const res = await authCall('/get-session', { cookie: withHint(u.cookie) })
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
    expectCleared(res.headers)
  })
})

describe('get-session', () => {
  test('a live session without the hint gets it (sessions from before the hint)', async () => {
    const u = await signUp('hint-backfill')
    const res = await authCall('/get-session', { cookie: u.cookie })
    expect(res.status).toBe(200)
    const line = hintLine(res.headers)
    expect(line?.startsWith(`${SIGNED_IN_HINT}=1;`)).toBe(true)
    const maxAge = Number(attrs(line!).get('max-age'))
    expect(maxAge).toBeGreaterThan(2592000 - 120)
    expect(maxAge).toBeLessThanOrEqual(2592000)
  })

  test('with the hint already there: nothing', async () => {
    const u = await signUp('hint-has')
    const res = await authCall('/get-session', { cookie: withHint(u.cookie) })
    expect(res.status).toBe(200)
    expect(hintLine(res.headers)).toBeUndefined()
  })

  test('no cookies, or only the hint: no Set-Cookie at all (anonymous HTML stays shareable)', async () => {
    for (const cookie of [undefined, `${SIGNED_IN_HINT}=1`, `theme=dark; ${SIGNED_IN_HINT}=1`]) {
      const res = await authCall('/get-session', { cookie })
      expect(res.status).toBe(200)
      expect(await res.json()).toBeNull()
      expect(res.headers.getSetCookie()).toEqual([])
    }
  })
})

describe('server functions (auth().api through tanstackStartCookies)', () => {
  /** getViewer as publicFn runs it, inside a Start request scope; returns the viewer and the response's Set-Cookie lines. */
  async function viewerIn(cookie: string | null) {
    const headers = new Headers({ origin: SITE_URL })
    if (cookie) headers.set('cookie', cookie)
    let viewer: Awaited<ReturnType<typeof getViewer>> | undefined
    let setCookies: string[] = []
    await createServerEntry({
      fetch: async () => {
        viewer = await getViewer(headers)
        setCookies = new Headers(getResponseHeaders() as HeadersInit).getSetCookie()
        return new Response(null, { status: 204 })
      },
    }).fetch(new Request(`${SITE_URL}/_serverFn/test`, { headers }))
    return { viewer, setCookies }
  }

  test('a signed-in request without the hint gets it on the Start response', async () => {
    const u = await signUp('hint-fn')
    const { viewer, setCookies } = await viewerIn(u.cookie)
    expect(viewer?.id).toBe(u.id)
    expect(setCookies.some((c) => c.startsWith(`${SIGNED_IN_HINT}=1;`))).toBe(true)
  })

  test('an anonymous request, even with a stale hint, gets no Set-Cookie', async () => {
    for (const cookie of [null, `${SIGNED_IN_HINT}=1`]) {
      const { viewer, setCookies } = await viewerIn(cookie)
      expect(viewer).toBeNull()
      expect(setCookies).toEqual([])
    }
  })
})
