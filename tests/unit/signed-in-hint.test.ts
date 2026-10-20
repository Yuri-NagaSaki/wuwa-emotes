import { describe, expect, test } from 'bun:test'
import { backfillChange } from '#/server/auth/signed-in-hint'
import {
  HINT_MAX_AGE,
  hasSignedInHint,
  hintChangeFor,
  refreshOutcome,
  SIGNED_IN_HINT,
  VIEWER_BOOT,
  VIEWER_PENDING_ATTR,
  VIEWER_PENDING_MS,
  viewerRefreshNeeded,
} from '#/shared/signed-in-hint'

// The signed-in hint cookie: what an auth response does to it, when the browser re-checks the viewer,
// and the boot script. The Better Auth wiring is covered in tests/integration/signed-in-hint.test.ts,
// the browser behaviour by tests/pages/cached-viewer.ts.

const SECURE = '__Secure-better-auth.session_token'
const PLAIN = 'better-auth.session_token'

describe('hasSignedInHint', () => {
  test.each([
    ['tp_signed_in=1', true],
    ['a=1; tp_signed_in=1', true],
    ['tp_signed_in=1;b=2', true],
    [' tp_signed_in = 1 ', true],
    ['tp_signed_in=0', false],
    ['tp_signed_in=', false],
    ['tp_signed_in', false],
    ['xtp_signed_in=1', false],
    ['tp_signed_in_x=1', false],
    [`${SECURE}=abc.def`, false],
    ['', false],
  ])('%p → %p', (cookie, expected) => {
    expect(hasSignedInHint(cookie)).toBe(expected)
  })

  test('null and undefined', () => {
    expect(hasSignedInHint(null)).toBe(false)
    expect(hasSignedInHint(undefined)).toBe(false)
  })
})

describe('hintChangeFor (follows the session cookie)', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')

  test('a session cookie with Max-Age sets the hint for as long', () => {
    expect(hintChangeFor([`${SECURE}=tok.sig; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`], SECURE, now)).toEqual({ action: 'set', maxAge: 2592000 })
  })

  test('a browser-session cookie (remember me off) sets a browser-session hint', () => {
    expect(hintChangeFor([`${PLAIN}=tok.sig; Path=/; HttpOnly; SameSite=Lax`], PLAIN, now)).toEqual({ action: 'set', maxAge: undefined })
  })

  test('Expires is used when there is no Max-Age', () => {
    const expires = new Date(now + 3600_000).toUTCString()
    expect(hintChangeFor([`${PLAIN}=tok; Expires=${expires}; Path=/`], PLAIN, now)).toEqual({ action: 'set', maxAge: 3600 })
  })

  test('an expired session cookie clears the hint', () => {
    expect(hintChangeFor([`${SECURE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`], SECURE, now)).toEqual({ action: 'clear' })
    expect(hintChangeFor([`${PLAIN}=tok; Max-Age=0; Path=/`], PLAIN, now)).toEqual({ action: 'clear' })
    expect(hintChangeFor([`${PLAIN}=; Path=/`], PLAIN, now)).toEqual({ action: 'clear' })
    expect(hintChangeFor([`${PLAIN}=tok; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`], PLAIN, now)).toEqual({ action: 'clear' })
  })

  test('Max-Age wins over Expires', () => {
    expect(hintChangeFor([`${PLAIN}=tok; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60`], PLAIN, now)).toEqual({ action: 'set', maxAge: 60 })
  })

  test('the last session-cookie entry wins (结束模拟: old one expired, the 站长’s set)', () => {
    const expire = `${SECURE}=; Max-Age=0; Path=/`
    const set = `${SECURE}=admin.sig; Max-Age=2592000; Path=/`
    expect(hintChangeFor([expire, 'other=1', set], SECURE, now)).toEqual({ action: 'set', maxAge: 2592000 })
    expect(hintChangeFor([set, expire], SECURE, now)).toEqual({ action: 'clear' })
  })

  test('other cookies, look-alike names and the other prefix are ignored', () => {
    expect(hintChangeFor([], SECURE, now)).toBeNull()
    expect(hintChangeFor(['__Secure-better-auth.session_data=x; Max-Age=0', 'better-auth.dont_remember=; Max-Age=0'], SECURE, now)).toBeNull()
    expect(hintChangeFor([`${PLAIN}=tok; Max-Age=60`], SECURE, now)).toBeNull()
    expect(hintChangeFor([`${SECURE}_multi-abc=tok; Max-Age=60`], SECURE, now)).toBeNull()
    expect(hintChangeFor([`${SIGNED_IN_HINT}=1; Max-Age=60`], SECURE, now)).toBeNull()
  })
})

describe('backfillChange (sessions from before the hint)', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  const live = { session: { expiresAt: new Date(now + 10 * 86_400_000) }, user: { banned: false } }

  test('a live session without the hint in the request sets it until the session ends', () => {
    expect(backfillChange('/get-session', live, 'other=1', now)).toEqual({ action: 'set', maxAge: 10 * 86_400 })
    expect(backfillChange('/get-session', live, null, now)).toEqual({ action: 'set', maxAge: 10 * 86_400 })
  })

  test('never longer than the session length; ISO strings work too', () => {
    const far = { session: { expiresAt: new Date(now + 90 * 86_400_000).toISOString() }, user: {} }
    expect(backfillChange('/get-session', far, null, now)).toEqual({ action: 'set', maxAge: HINT_MAX_AGE })
  })

  test('nothing when the hint is there, no session, banned, expired or another endpoint', () => {
    expect(backfillChange('/get-session', live, 'tp_signed_in=1', now)).toBeNull()
    expect(backfillChange('/get-session', null, null, now)).toBeNull()
    expect(backfillChange('/get-session', { session: null, user: null }, null, now)).toBeNull()
    expect(backfillChange('/get-session', { ...live, user: { banned: true } }, null, now)).toBeNull()
    expect(backfillChange('/get-session', { ...live, session: { expiresAt: new Date(now - 1000) } }, null, now)).toBeNull()
    expect(backfillChange('/sign-in/email', live, null, now)).toBeNull()
    expect(backfillChange(undefined, live, null, now)).toBeNull()
  })
})

describe('refresh decision', () => {
  test.each([
    [{ viewer: null, hint: true, attempted: false }, true],
    [{ viewer: undefined, hint: true, attempted: false }, true],
    // anonymous visitors: no request
    [{ viewer: null, hint: false, attempted: false }, false],
    // the HTML already knows the viewer
    [{ viewer: { id: 'u' }, hint: true, attempted: false }, false],
    [{ viewer: { id: 'u' }, hint: false, attempted: false }, false],
    // once per page load
    [{ viewer: null, hint: true, attempted: true }, false],
  ])('%j → %p', (state, expected) => {
    expect(viewerRefreshNeeded(state)).toBe(expected)
  })

  test('outcome of the re-check', () => {
    expect(refreshOutcome({ viewer: { id: 'u' } })).toBe('apply')
    expect(refreshOutcome({ viewer: null })).toBe('clear-hint')
    // request failed: keep the anonymous chrome and the hint
    expect(refreshOutcome(null)).toBe('keep')
  })
})

describe('VIEWER_BOOT', () => {
  function runBoot(cookie: string) {
    const attrs = new Map<string, string>()
    const timers: { fn: () => void; ms: number }[] = []
    const document = {
      cookie,
      documentElement: {
        setAttribute: (n: string, v: string) => attrs.set(n, v),
        removeAttribute: (n: string) => attrs.delete(n),
      },
    }
    new Function('document', 'setTimeout', VIEWER_BOOT)(document, (fn: () => void, ms: number) => timers.push({ fn, ms }))
    return { attrs, timers }
  }

  test('marks <html> only when the hint is present, and unmarks it after the timeout', () => {
    for (const cookie of ['tp_signed_in=1', 'a=b; tp_signed_in=1', 'tp_signed_in=1; a=b']) {
      const { attrs, timers } = runBoot(cookie)
      expect(attrs.has(VIEWER_PENDING_ATTR)).toBe(true)
      expect(timers).toHaveLength(1)
      expect(timers[0]!.ms).toBe(VIEWER_PENDING_MS)
      timers[0]!.fn()
      expect(attrs.has(VIEWER_PENDING_ATTR)).toBe(false)
    }
    for (const cookie of ['', 'tp_signed_in=0', 'xtp_signed_in=1', 'tp_signed_in=10', `${SECURE}=abc`]) {
      const { attrs, timers } = runBoot(cookie)
      expect(attrs.size).toBe(0)
      expect(timers).toHaveLength(0)
    }
  })

  test('holds only the cookie name and the attribute', () => {
    expect(VIEWER_BOOT).toContain(SIGNED_IN_HINT)
    expect(VIEWER_BOOT).toContain(VIEWER_PENDING_ATTR)
    expect(VIEWER_BOOT).not.toContain('session_token')
    expect(VIEWER_BOOT).not.toContain('</script>')
  })
})
