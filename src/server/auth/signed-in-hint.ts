import { createAuthMiddleware } from 'better-auth/api'
import { HINT_MAX_AGE, hasSignedInHint, hintChangeFor, SIGNED_IN_HINT, type HintChange } from '#/shared/signed-in-hint'

// Better Auth after hook that keeps the signed-in hint (src/shared/signed-in-hint.ts) in step with the
// session cookie, for every endpoint and both entry points (/api/auth/* and auth().api.* from server
// functions; tanstackStartCookies, the last plugin, copies the cookie onto the Start response):
// - a response that sets the session cookie sets the hint: sign-in, sign-up that signs in, the
//   verification link's auto sign-in, 模拟登录 and 结束模拟, the daily session refresh;
// - a response that expires the session cookie clears it: sign-out, a session that no longer exists;
// - get-session with a live session and no hint in the request sets it (sessions from before the hint).
// Only responses to requests that carry a session cookie ever get the hint's Set-Cookie, and those are
// private already. A stale hint without a session is cleared by the browser, never here: a Set-Cookie
// on anonymous HTML would make it private (decideCacheControl).

interface SessionLike {
  session?: { expiresAt?: Date | string | null } | null
  user?: { banned?: boolean | null } | null
}

/** The backfill case: a live session (not banned: getViewer in session.ts treats those as signed out) and no hint yet. */
export function backfillChange(path: string | undefined, returned: unknown, cookieHeader: string | null | undefined, now = Date.now()): HintChange | null {
  if (path !== '/get-session' || !returned || typeof returned !== 'object') return null
  const s = returned as SessionLike
  if (!s.session || !s.user || s.user.banned || hasSignedInHint(cookieHeader)) return null
  const expiresAt = s.session.expiresAt ? new Date(s.session.expiresAt).getTime() : NaN
  const left = Number.isNaN(expiresAt) ? HINT_MAX_AGE : Math.ceil((expiresAt - now) / 1000)
  return left > 0 ? { action: 'set', maxAge: Math.min(left, HINT_MAX_AGE) } : null
}

export const signedInHintHook = createAuthMiddleware(async (ctx) => {
  const session = ctx.context.authCookies.sessionToken
  const setCookies = ctx.context.responseHeaders?.getSetCookie() ?? []
  const change = hintChangeFor(setCookies, session.name) ?? backfillChange(ctx.path, ctx.context.returned, ctx.headers?.get('cookie'))
  if (!change) return
  ctx.setCookie(SIGNED_IN_HINT, change.action === 'set' ? '1' : '', {
    path: '/',
    sameSite: 'lax',
    secure: session.attributes.secure,
    httpOnly: false,
    maxAge: change.action === 'set' ? change.maxAge : 0,
  })
})
