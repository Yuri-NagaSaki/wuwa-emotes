import type { Env } from '../env'

// Response headers added to everything that passes through Start's request middleware (src/start.ts):
// security headers on every response, and the HTML cache rule from docs/ARCHITECTURE.md §2.1.
// Pure functions so the decisions can be unit-tested without a server.

export interface SecurityConfig {
  production: boolean
  /** origin of the Cap Standalone server the widget talks to */
  capOrigin: string
  /** origins presigned S3 URLs can point at (browser uploads, batch downloads, 查看原图) */
  storageOrigins: string[]
  /** origin of PUBLIC_IMG_BASE (web images straight from the bucket), when set: img-src only */
  imageOrigins: string[]
}

export function securityConfig(
  e: Pick<Env, 'NODE_ENV' | 'CAP_API_ENDPOINT' | 'S3_ENDPOINT' | 'S3_PUBLIC_ENDPOINT' | 'S3_BUCKET' | 'S3_FORCE_PATH_STYLE'> & Partial<Pick<Env, 'PUBLIC_IMG_BASE'>>,
): SecurityConfig {
  return {
    production: e.NODE_ENV === 'production',
    capOrigin: new URL(e.CAP_API_ENDPOINT).origin,
    storageOrigins: storageOrigins(e),
    imageOrigins: e.PUBLIC_IMG_BASE ? [new URL(e.PUBLIC_IMG_BASE).origin] : [],
  }
}

/**
 * Presigned URLs use S3_PUBLIC_ENDPOINT (or S3_ENDPOINT). With virtual-hosted style (R2 in production,
 * S3_FORCE_PATH_STYLE=false) the SDK puts the bucket in the host name: https://<bucket>.<host>/<key>.
 */
export function storageOrigins(e: Pick<Env, 'S3_ENDPOINT' | 'S3_PUBLIC_ENDPOINT' | 'S3_BUCKET' | 'S3_FORCE_PATH_STYLE'>): string[] {
  const endpoint = new URL(e.S3_PUBLIC_ENDPOINT || e.S3_ENDPOINT)
  const origins = new Set([endpoint.origin])
  if (!e.S3_FORCE_PATH_STYLE) origins.add(`${endpoint.protocol}//${e.S3_BUCKET}.${endpoint.host}`)
  return [...origins]
}

/**
 * Content-Security-Policy.
 * - script-src 'unsafe-inline': TanStack Start emits inline hydration/dehydration scripts. The router
 *   supports a nonce (createRouter({ ssr: { nonce } })), but that has to be wired in src/router.tsx;
 *   until then a nonce here would block those scripts (browsers ignore 'unsafe-inline' once a nonce is
 *   present). Anonymous HTML is also CDN-cached for 60 s, so a nonce would be shared by visitors anyway.
 * - 'wasm-unsafe-eval': the Cap widget compiles its proof-of-work WASM (served from /cap/).
 * - worker-src/child-src blob:: Cap solver workers are created from blob: URLs.
 * - frame-src 'self': Cap's instrumentation runs in <iframe sandbox="allow-scripts" srcdoc=…>. A srcdoc
 *   frame is not fetched, so frame-src does not apply to it; it inherits this policy, and its inline
 *   script is allowed by script-src 'unsafe-inline'.
 * - 'unsafe-eval': that instrumentation script evaluates code inside the frame. Without it the browser
 *   blocks the eval, the widget waits for "Instrumentation timeout" and stays at 验证中 (seen on
 *   production). It cannot be scoped to the frame, which inherits this policy.
 * - img-src includes the storage origins: 查看原图 is a 302 to a presigned URL, which an <img> must load;
 *   and the PUBLIC_IMG_BASE origin (posters, previews and portraits from the bucket's public domain).
 *   connect-src does not: scripts read image bytes from the same-origin /img only.
 * Checked in headless Chromium against the production Cap instance: inline script, blob: worker
 * compiling WASM, the instrumentation frame and fetch to the Cap origin work; fetch to other origins is
 * blocked.
 */
export function buildCsp(cfg: SecurityConfig): string {
  const storage = cfg.storageOrigins.join(' ')
  const images = [...new Set([...cfg.storageOrigins, ...cfg.imageOrigins])].join(' ')
  const connect = ["'self'", cfg.capOrigin, storage]
  // Vite's HMR client uses a websocket in development
  if (!cfg.production) connect.push('ws:', 'wss:')
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"],
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', `'self' data: blob: ${images}`],
    ['font-src', "'self'"],
    ['connect-src', connect.join(' ')],
    ['worker-src', "'self' blob:"],
    ['child-src', "'self' blob:"],
    ['frame-src', "'self'"],
    ['frame-ancestors', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
  ]
  return directives.map(([name, value]) => `${name} ${value}`).join('; ')
}

export function securityHeaders(cfg: SecurityConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-security-policy': buildCsp(cfg),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  }
  if (cfg.production) headers['strict-transport-security'] = 'max-age=31536000'
  return headers
}

// ---- cache rules ----

export const PUBLIC_HTML_CACHE = 'public, s-maxage=60, stale-while-revalidate=600'
/** Public catalog server functions (edge-cache.ts): shared by Cloudflare, not kept by browsers. */
export const PUBLIC_FN_CACHE = 'public, s-maxage=30, stale-while-revalidate=300'
export const PRIVATE_NO_STORE = 'private, no-store'

/**
 * Better Auth's session cookie: `__Secure-` prefixed in production (useSecureCookies), plain otherwise.
 * Both names count in every environment, so a stray cookie can only make a response more private.
 */
export const SESSION_COOKIE_NAMES = ['__Secure-better-auth.session_token', 'better-auth.session_token'] as const

export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    const name = (eq === -1 ? part : part.slice(0, eq)).trim()
    if ((SESSION_COOKIE_NAMES as readonly string[]).includes(name) && part.slice(eq + 1).trim() !== '') return true
  }
  return false
}

/** Case-insensitive, like the router's default matching: /ME must be as private as /me. */
function underPrefix(pathname: string, prefix: string): boolean {
  const p = pathname.toLowerCase()
  return p === prefix || p.startsWith(prefix + '/')
}

/** Routes that set their own caching (/img is immutable, /review-img and /dl are private). */
const SELF_CACHED_PREFIXES = ['/img', '/review-img', '/dl']
/** Pages that need a signed-in user; never shared (§2.1). */
const PRIVATE_PAGE_PREFIXES = ['/admin', '/me', '/submit']

export type PathClass = 'api' | 'self-cached' | 'page'

export function classifyPath(pathname: string): PathClass {
  if (underPrefix(pathname, '/api')) return 'api'
  if (SELF_CACHED_PREFIXES.some((p) => underPrefix(pathname, p))) return 'self-cached'
  return 'page'
}

function isStrict(cacheControl: string | null): boolean {
  return !!cacheControl && /(^|[\s,])(private|no-store|no-cache)([\s,=]|$)/i.test(cacheControl)
}

export interface CacheInput {
  method: string
  pathname: string
  handlerType: 'serverFn' | 'router'
  cookieHeader: string | null
  status: number
  contentType: string | null
  cacheControl: string | null
  hasSetCookie: boolean
}

/** The Cache-Control the response should leave with; null keeps whatever it has. */
export function decideCacheControl(i: CacheInput): string | null {
  const decided = baseDecision(i)
  const effective = decided ?? i.cacheControl
  // Cloudflare never caches a response with Set-Cookie, and a shared cache must never store one.
  if (i.hasSetCookie && !isStrict(effective)) return PRIVATE_NO_STORE
  return decided
}

/** A header that lets a shared cache (Cloudflare) store the response. */
function isShared(cacheControl: string | null): boolean {
  return !!cacheControl && !isStrict(cacheControl) && /(^|[\s,])(public|s-maxage=)/i.test(cacheControl)
}

function baseDecision(i: CacheInput): string | null {
  if (i.handlerType === 'serverFn') {
    // Only a successful anonymous GET may leave shareable: a session cookie means the answer could
    // be someone's own (and Cloudflare ignores Vary: Cookie), and writes or errors are never shared.
    if (hasSessionCookie(i.cookieHeader)) return isStrict(i.cacheControl) ? null : PRIVATE_NO_STORE
    if (isShared(i.cacheControl)) return i.method.toUpperCase() !== 'GET' || i.status !== 200 ? 'no-store' : null
    return i.cacheControl ? null : 'no-store'
  }
  const cls = classifyPath(i.pathname)
  if (cls === 'self-cached') return null
  if (cls === 'api') return i.cacheControl ? null : 'no-store'

  // page routes
  const method = i.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return i.cacheControl ? null : 'no-store'
  if (hasSessionCookie(i.cookieHeader)) return PRIVATE_NO_STORE
  if (PRIVATE_PAGE_PREFIXES.some((p) => underPrefix(i.pathname, p))) return PRIVATE_NO_STORE
  if (isStrict(i.cacheControl)) return null
  if (i.status >= 500) return 'no-store'
  const html = !!i.contentType && i.contentType.toLowerCase().startsWith('text/html')
  if (html && ((i.status >= 200 && i.status < 300) || i.status === 404 || i.status === 410)) return PUBLIC_HTML_CACHE
  // redirects and anything else: keep an explicit header, otherwise don't let a CDN guess a TTL
  return i.cacheControl ? null : 'no-store'
}

export interface RequestFacts {
  method: string
  pathname: string
  handlerType: 'serverFn' | 'router'
  cookieHeader: string | null
}

/** Header values to set on the response before it leaves the app. */
export function headerChanges(req: RequestFacts, status: number, headers: Headers, cfg: SecurityConfig): [string, string][] {
  const changes: [string, string][] = []
  for (const [name, value] of Object.entries(securityHeaders(cfg))) {
    // a route may tighten its own policy (e.g. a stricter CSP); only fill in what is missing
    if (!headers.has(name)) changes.push([name, value])
  }
  const cacheControl = decideCacheControl({
    ...req,
    status,
    contentType: headers.get('content-type'),
    cacheControl: headers.get('cache-control'),
    hasSetCookie: headers.getSetCookie().length > 0,
  })
  if (cacheControl && cacheControl !== headers.get('cache-control')) changes.push(['cache-control', cacheControl])
  return changes
}

/**
 * Apply the final headers. Mutates in place so Start keeps ownership of the (possibly streaming) body;
 * responses with immutable headers (Response.redirect, fetch results) are rebuilt around the same body.
 */
export function withFinalHeaders(req: RequestFacts, response: Response, cfg: SecurityConfig): Response {
  const changes = headerChanges(req, response.status, response.headers, cfg)
  if (!changes.length) return response
  try {
    for (const [name, value] of changes) response.headers.set(name, value)
    return response
  } catch {
    const headers = new Headers(response.headers)
    for (const [name, value] of changes) headers.set(name, value)
    const bodyless = response.status === 204 || response.status === 205 || response.status === 304
    return new Response(bodyless ? null : response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
