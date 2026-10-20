// The signed-in hint: a cookie `tp_signed_in=1` that only says "this browser has a session". It holds
// no identity and is not HttpOnly, because the page reads it.
//
// Why: Cloudflare's cache key ignores cookies. Once an anonymous request has put a public page in the
// edge cache, a signed-in visitor can be served that anonymous HTML too (docs/ARCHITECTURE.md §2.1).
// The root loader's viewer is then null and stays null. After hydration the browser sees the hint and
// asks again (src/ui/shell/viewer-refresh.ts).
//
// Who writes it: Better Auth's after hook (src/server/auth/signed-in-hint.ts) mirrors the session
// cookie. When a response sets the session cookie it sets the hint; when it expires the session cookie
// it clears the hint. The browser clears a hint that the server no longer backs. The edge-cache rule
// never reads the hint (hasSessionCookie in src/server/http/security.ts), so it cannot make anonymous
// HTML private.

export const SIGNED_IN_HINT = 'tp_signed_in'
const HINT_VALUE = '1'
/** Lifetime when the session cookie gives none to copy: the session length (src/server/auth/auth.ts). */
export const HINT_MAX_AGE = 60 * 60 * 24 * 30
/** Set on <html> by VIEWER_BOOT while the viewer is re-checked; site.css hides 登录 meanwhile. */
export const VIEWER_PENDING_ATTR = 'data-viewer-pending'
/** The boot script drops the attribute after this long even if the page never hydrates. */
export const VIEWER_PENDING_MS = 3000

/** Does a Cookie header (or document.cookie) carry the hint? */
export function hasSignedInHint(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === SIGNED_IN_HINT && part.slice(eq + 1).trim() === HINT_VALUE) return true
  }
  return false
}

export type HintChange = { action: 'set'; /** seconds; undefined = until the browser closes */ maxAge: number | undefined } | { action: 'clear' }

/**
 * What the hint should do after a response with these Set-Cookie values: follow the session cookie.
 * The last session-cookie entry wins (the browser applies them in order). null when the response
 * leaves the session cookie alone.
 */
export function hintChangeFor(setCookies: readonly string[], sessionCookieName: string, now = Date.now()): HintChange | null {
  let change: HintChange | null = null
  for (const raw of setCookies) {
    const [pair = '', ...attrs] = raw.split(';')
    const eq = pair.indexOf('=')
    if (eq === -1 || pair.slice(0, eq).trim() !== sessionCookieName) continue
    const value = pair.slice(eq + 1).trim()
    let maxAge: number | undefined
    let expires: number | undefined
    for (const attr of attrs) {
      const i = attr.indexOf('=')
      const name = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase()
      const v = i === -1 ? '' : attr.slice(i + 1).trim()
      if (name === 'max-age' && /^-?\d+$/.test(v)) maxAge = Number(v)
      else if (name === 'expires') expires = Date.parse(v)
    }
    // Max-Age wins over Expires (RFC 6265 §5.3)
    const seconds = maxAge ?? (expires !== undefined && !Number.isNaN(expires) ? Math.ceil((expires - now) / 1000) : undefined)
    change = !value || (seconds !== undefined && seconds <= 0) ? { action: 'clear' } : { action: 'set', maxAge: seconds }
  }
  return change
}

/** After hydration: ask the server again only when the page is anonymous but the hint says otherwise. */
export function viewerRefreshNeeded(s: { viewer: unknown; hint: boolean; attempted: boolean }): boolean {
  return s.viewer == null && s.hint && !s.attempted
}

/** What to do with the answer: show the viewer, drop a hint nobody backs, or (request failed) leave things be. */
export function refreshOutcome(fresh: { viewer: unknown } | null): 'apply' | 'clear-hint' | 'keep' {
  if (!fresh) return 'keep'
  return fresh.viewer != null ? 'apply' : 'clear-hint'
}

/**
 * Inline boot script (src/routes/__root.tsx), before first paint: with the hint present, mark <html> so
 * the header shows no 登录 while the viewer is re-checked. Contains only the cookie name and attribute.
 */
export const VIEWER_BOOT = `(function(){try{if((" "+document.cookie+";").indexOf(${JSON.stringify(` ${SIGNED_IN_HINT}=${HINT_VALUE};`)})<0)return;var d=document.documentElement;d.setAttribute(${JSON.stringify(VIEWER_PENDING_ATTR)},"");setTimeout(function(){d.removeAttribute(${JSON.stringify(VIEWER_PENDING_ATTR)})},${VIEWER_PENDING_MS})}catch(e){}})()`
