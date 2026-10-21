import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  buildCsp,
  type CacheInput,
  classifyPath,
  decideCacheControl,
  type PathClass,
  hasSessionCookie,
  PRIVATE_NO_STORE,
  PUBLIC_FN_CACHE,
  PUBLIC_HTML_CACHE,
  securityConfig,
  securityHeaders,
  storageOrigins,
  withFinalHeaders,
} from '#/server/http/security'

const devCfg = securityConfig({
  NODE_ENV: 'development',
  CAP_API_ENDPOINT: 'https://cap.anibt.net/3358fb7a52/',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT: '',
  S3_BUCKET: 'chaochi-dev',
  S3_FORCE_PATH_STYLE: true,
})
const prodCfg = securityConfig({
  NODE_ENV: 'production',
  CAP_API_ENDPOINT: 'https://cap.anibt.net/3358fb7a52/',
  S3_ENDPOINT: 'https://acct.storage.example',
  S3_PUBLIC_ENDPOINT: '',
  S3_BUCKET: 'site-bucket',
  S3_FORCE_PATH_STYLE: false,
})

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name!, values]
    }),
  )
}

describe('CSP', () => {
  test('required directives', () => {
    const d = directives(buildCsp(prodCfg))
    expect(d.get('default-src')).toEqual(["'self'"])
    expect(d.get('script-src')).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"])
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(d.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']))
    expect(d.get('font-src')).toEqual(["'self'"])
    expect(d.get('connect-src')).toEqual(["'self'", 'https://cap.anibt.net', 'https://acct.storage.example', 'https://site-bucket.acct.storage.example'])
    expect(d.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(d.get('child-src')).toEqual(["'self'", 'blob:'])
    expect(d.get('frame-src')).toEqual(["'self'"])
    expect(d.get('frame-ancestors')).toEqual(["'none'"])
    expect(d.get('object-src')).toEqual(["'none'"])
    expect(d.get('base-uri')).toEqual(["'self'"])
    expect(d.get('form-action')).toEqual(["'self'"])
  })

  test("no nonce or hash next to 'unsafe-inline' (browsers would ignore it)", () => {
    for (const cfg of [devCfg, prodCfg]) {
      const csp = buildCsp(cfg)
      expect(csp).not.toMatch(/'nonce-|'sha(256|384|512)-|'strict-dynamic'/)
    }
  })

  test('websocket for Vite HMR only outside production', () => {
    expect(directives(buildCsp(devCfg)).get('connect-src')).toEqual(expect.arrayContaining(['ws:', 'wss:']))
    expect(directives(buildCsp(prodCfg)).get('connect-src')).not.toContain('ws:')
  })

  test('img-src adds the PUBLIC_IMG_BASE origin when set; connect-src does not (no script reads those bytes)', () => {
    const plain = directives(buildCsp(prodCfg))
    expect(plain.get('img-src')).not.toContain('https://i.sparxie.example')
    const cfg = securityConfig({ ...prodLike(), PUBLIC_IMG_BASE: 'https://i.sparxie.example' })
    const d = directives(buildCsp(cfg))
    expect(d.get('img-src')).toContain('https://i.sparxie.example')
    expect(d.get('connect-src')).not.toContain('https://i.sparxie.example')
    // a base with a path (path-style bucket) contributes its origin only
    const path = directives(buildCsp(securityConfig({ ...prodLike(), PUBLIC_IMG_BASE: 'http://127.0.0.1:9100/bucket' })))
    expect(path.get('img-src')).toContain('http://127.0.0.1:9100')
    expect(securityConfig({ ...prodLike(), PUBLIC_IMG_BASE: '' }).imageOrigins).toEqual([])
  })

  test('Cap origin follows CAP_API_ENDPOINT', () => {
    const cfg = securityConfig({ ...prodLike(), CAP_API_ENDPOINT: 'https://captcha.example:8443/abc/' })
    expect(directives(buildCsp(cfg)).get('connect-src')).toContain('https://captcha.example:8443')
  })
})

function prodLike() {
  return {
    NODE_ENV: 'production' as const,
    CAP_API_ENDPOINT: 'https://cap.anibt.net/3358fb7a52/',
    S3_ENDPOINT: 'https://acct.storage.example',
    S3_PUBLIC_ENDPOINT: '',
    S3_BUCKET: 'site-bucket',
    S3_FORCE_PATH_STYLE: false,
  }
}

describe('storage origins', () => {
  test('path-style: endpoint origin only', () => {
    expect(storageOrigins({ S3_ENDPOINT: 'http://127.0.0.1:9000', S3_PUBLIC_ENDPOINT: '', S3_BUCKET: 'b', S3_FORCE_PATH_STYLE: true })).toEqual([
      'http://127.0.0.1:9000',
    ])
  })

  test('virtual-hosted: bucket subdomain too', () => {
    expect(storageOrigins({ S3_ENDPOINT: 'https://x.example', S3_PUBLIC_ENDPOINT: '', S3_BUCKET: 'b', S3_FORCE_PATH_STYLE: false })).toEqual([
      'https://x.example',
      'https://b.x.example',
    ])
  })

  test('S3_PUBLIC_ENDPOINT wins (presigned URLs use it)', () => {
    expect(
      storageOrigins({ S3_ENDPOINT: 'http://rustfs:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:9000', S3_BUCKET: 'b', S3_FORCE_PATH_STYLE: true }),
    ).toEqual(['http://localhost:9000'])
  })

  // Real presigned URLs from src/server/media/s3.ts, generated in a child process with its own env.
  test.each([
    ['virtual-hosted', { S3_ENDPOINT: 'https://s3.example.test', S3_FORCE_PATH_STYLE: 'false' }],
    ['path-style', { S3_ENDPOINT: 'http://127.0.0.1:9000', S3_FORCE_PATH_STYLE: 'true' }],
    ['public endpoint', { S3_ENDPOINT: 'http://rustfs:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:9100', S3_FORCE_PATH_STYLE: 'true' }],
  ])('connect-src and img-src cover presigned URLs (%s)', (_name, s3env) => {
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'fixtures', 'presign-origin.ts')], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'development',
        S3_BUCKET: 'chaochi-lane-a',
        S3_ACCESS_KEY_ID: 'fixture',
        S3_SECRET_ACCESS_KEY: 'fixture-secret',
        DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
        ...s3env,
      },
      cwd: join(import.meta.dir, '..', '..'),
    })
    expect(proc.exitCode).toBe(0)
    const out = JSON.parse(proc.stdout.toString()) as { get: string; put: string; csp: string }
    const d = directives(out.csp)
    for (const u of [out.get, out.put]) {
      expect(d.get('connect-src')).toContain(new URL(u).origin)
      expect(d.get('img-src')).toContain(new URL(u).origin)
    }
  })
})

describe('security headers', () => {
  test('always present; HSTS only in production', () => {
    for (const cfg of [devCfg, prodCfg]) {
      const h = securityHeaders(cfg)
      expect(h['x-content-type-options']).toBe('nosniff')
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
      expect(h['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
      expect(h['content-security-policy']).toBe(buildCsp(cfg))
    }
    expect(securityHeaders(devCfg)['strict-transport-security']).toBeUndefined()
    expect(securityHeaders(prodCfg)['strict-transport-security']).toBe('max-age=31536000')
  })
})

describe('session cookie detection', () => {
  test.each([
    ['better-auth.session_token=abc.def', true],
    ['__Secure-better-auth.session_token=abc.def', true],
    ['theme=dark; better-auth.session_token=abc', true],
    ['a=1;__Secure-better-auth.session_token=x;b=2', true],
    ['better-auth.session_token=', false],
    ['better-auth.session_token_x=abc', false],
    ['xbetter-auth.session_token=abc', false],
    ['better-auth.session_data=abc', false],
    ['theme=dark', false],
    ['', false],
  ])('%p → %p', (cookie, expected) => {
    expect(hasSessionCookie(cookie)).toBe(expected)
  })

  test('null header', () => {
    expect(hasSessionCookie(null)).toBe(false)
  })
})

describe('path classes', () => {
  test.each<[string, PathClass]>([
    ['/api', 'api'],
    ['/api/health', 'api'],
    ['/api/auth/sign-in/email', 'api'],
    ['/apiary', 'page'],
    ['/API/health', 'api'],
    ['/IMG/v1/x', 'self-cached'],
    ['/img/v1/p240/a/r-0a7bf47f0ec26d3843bf.r1.webp', 'self-cached'],
    ['/images', 'page'],
    ['/review-img/v1/p240/a/r-0a7bf47f0ec26d3843bf.webp', 'self-cached'],
    ['/dl/e/r-0a7bf47f0ec26d3843bf', 'self-cached'],
    ['/dl/p/pack.zip', 'self-cached'],
    ['/', 'page'],
    ['/packs/abc', 'page'],
  ])('%s → %s', (path, cls) => {
    expect(classifyPath(path)).toBe(cls)
  })
})

function input(over: Partial<CacheInput> = {}): CacheInput {
  return {
    method: 'GET',
    pathname: '/packs/abc',
    handlerType: 'router',
    cookieHeader: null,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    cacheControl: null,
    hasSetCookie: false,
    ...over,
  }
}

describe('HTML cache rule (§2.1)', () => {
  test('anonymous page → shared cache', () => {
    expect(decideCacheControl(input())).toBe(PUBLIC_HTML_CACHE)
    expect(decideCacheControl(input({ method: 'HEAD' }))).toBe(PUBLIC_HTML_CACHE)
    expect(decideCacheControl(input({ pathname: '/' }))).toBe(PUBLIC_HTML_CACHE)
    expect(decideCacheControl(input({ status: 404 }))).toBe(PUBLIC_HTML_CACHE)
  })

  test('session cookie (either name) → private, no-store', () => {
    expect(decideCacheControl(input({ cookieHeader: 'better-auth.session_token=a.b' }))).toBe(PRIVATE_NO_STORE)
    expect(decideCacheControl(input({ cookieHeader: '__Secure-better-auth.session_token=a.b' }))).toBe(PRIVATE_NO_STORE)
    // even if the route asked for public caching
    expect(decideCacheControl(input({ cookieHeader: 'better-auth.session_token=a', cacheControl: 'public, max-age=600' }))).toBe(PRIVATE_NO_STORE)
  })

  test('unrelated cookies do not make a page private', () => {
    expect(decideCacheControl(input({ cookieHeader: 'theme=dark' }))).toBe(PUBLIC_HTML_CACHE)
  })

  test('the signed-in hint alone stays out of the cache decision (src/shared/signed-in-hint.ts)', () => {
    expect(hasSessionCookie('tp_signed_in=1')).toBe(false)
    expect(decideCacheControl(input({ cookieHeader: 'tp_signed_in=1' }))).toBe(PUBLIC_HTML_CACHE)
    // a catalog server function that marked itself shareable stays shareable
    expect(decideCacheControl(input({ handlerType: 'serverFn', pathname: '/_serverFn/x', contentType: 'application/json', cacheControl: PUBLIC_FN_CACHE, cookieHeader: 'tp_signed_in=1' }))).toBeNull()
  })

  test('Set-Cookie never leaves on a shareable response', () => {
    expect(decideCacheControl(input({ hasSetCookie: true }))).toBe(PRIVATE_NO_STORE)
    expect(decideCacheControl(input({ hasSetCookie: true, cacheControl: 'public, max-age=60' }))).toBe(PRIVATE_NO_STORE)
    expect(
      decideCacheControl(input({ pathname: '/img/v1/p240/a/r-0a7bf47f0ec26d3843bf.r1.webp', hasSetCookie: true, cacheControl: 'public, max-age=31536000, immutable' })),
    ).toBe(PRIVATE_NO_STORE)
    expect(decideCacheControl(input({ pathname: '/api/auth/sign-in/email', hasSetCookie: true }))).toBe('no-store')
    // already private: unchanged
    expect(decideCacheControl(input({ pathname: '/api/x', hasSetCookie: true, cacheControl: 'no-store' }))).toBeNull()
  })

  test('signed-in-only pages are always private', () => {
    for (const p of ['/admin', '/admin/packs', '/me', '/me/favorites', '/submit', '/ME', '/Admin/packs', '/SUBMIT']) {
      expect(decideCacheControl(input({ pathname: p }))).toBe(PRIVATE_NO_STORE)
    }
    expect(decideCacheControl(input({ pathname: '/members' }))).toBe(PUBLIC_HTML_CACHE)
  })

  test('a stricter route header wins', () => {
    expect(decideCacheControl(input({ cacheControl: 'private, max-age=0' }))).toBeNull()
    expect(decideCacheControl(input({ cacheControl: 'no-store' }))).toBeNull()
    expect(decideCacheControl(input({ cacheControl: 'no-cache' }))).toBeNull()
    expect(decideCacheControl(input({ cacheControl: 'public, max-age=3600' }))).toBe(PUBLIC_HTML_CACHE)
  })

  test('errors, redirects and non-HTML pages are not shared by default', () => {
    expect(decideCacheControl(input({ status: 500 }))).toBe('no-store')
    expect(decideCacheControl(input({ status: 503, cacheControl: 'public, max-age=60' }))).toBe('no-store')
    expect(decideCacheControl(input({ status: 307, contentType: null }))).toBe('no-store')
    expect(decideCacheControl(input({ status: 301, contentType: null, cacheControl: 'public, max-age=86400' }))).toBeNull()
    expect(decideCacheControl(input({ status: 406, contentType: 'application/json' }))).toBe('no-store')
    expect(decideCacheControl(input({ method: 'POST' }))).toBe('no-store')
  })

  test('API and server functions default to no-store, keep explicit headers', () => {
    expect(decideCacheControl(input({ pathname: '/api/health', contentType: 'application/json' }))).toBe('no-store')
    expect(decideCacheControl(input({ pathname: '/api/x', cacheControl: 'public, max-age=30' }))).toBeNull()
    expect(decideCacheControl(input({ pathname: '/_serverFn/abc', handlerType: 'serverFn', contentType: 'application/json' }))).toBe('no-store')
  })

  test('public catalog server functions are shared only for an anonymous, successful GET', () => {
    const fn = (o: Partial<CacheInput>) => decideCacheControl(input({ pathname: '/_serverFn/abc', handlerType: 'serverFn', contentType: 'application/json', cacheControl: PUBLIC_FN_CACHE, ...o }))
    // anonymous GET: the handler's shared header leaves as it is
    expect(fn({})).toBeNull()
    expect(fn({ cookieHeader: 'theme=dark; tp-x=1' })).toBeNull()
    // a session cookie (either name) makes it private, whatever the handler said
    expect(fn({ cookieHeader: '__Secure-better-auth.session_token=abc' })).toBe(PRIVATE_NO_STORE)
    expect(fn({ cookieHeader: 'a=1; better-auth.session_token=abc' })).toBe(PRIVATE_NO_STORE)
    expect(fn({ cookieHeader: 'better-auth.session_token=abc', cacheControl: 'public, max-age=60' })).toBe(PRIVATE_NO_STORE)
    // writes, errors and redirects are never shared
    expect(fn({ method: 'POST' })).toBe('no-store')
    expect(fn({ status: 400 })).toBe('no-store')
    expect(fn({ status: 500 })).toBe('no-store')
    expect(fn({ status: 307 })).toBe('no-store')
    // Set-Cookie always wins
    expect(fn({ hasSetCookie: true })).toBe(PRIVATE_NO_STORE)
    // functions that set nothing (getPublicConfig, comments, favorites, account): no-store, and
    // private as well once the request carries a session
    expect(fn({ cacheControl: null })).toBe('no-store')
    expect(fn({ cacheControl: null, cookieHeader: '__Secure-better-auth.session_token=abc' })).toBe(PRIVATE_NO_STORE)
    expect(fn({ cacheControl: 'no-store', cookieHeader: '__Secure-better-auth.session_token=abc' })).toBeNull()
    expect(fn({ cacheControl: PRIVATE_NO_STORE, cookieHeader: '__Secure-better-auth.session_token=abc' })).toBeNull()
  })

  test('/img, /review-img and /dl keep their own headers', () => {
    for (const p of ['/img/v1/p240/a/r-0a7bf47f0ec26d3843bf.r1.webp', '/review-img/v1/p240/a/r-0a7bf47f0ec26d3843bf.webp', '/dl/e/r-0a7bf47f0ec26d3843bf']) {
      expect(decideCacheControl(input({ pathname: p, cookieHeader: 'better-auth.session_token=a', cacheControl: 'public, max-age=60' }))).toBeNull()
      expect(decideCacheControl(input({ pathname: p, cacheControl: null, contentType: 'image/webp' }))).toBeNull()
    }
  })
})

describe('withFinalHeaders', () => {
  const req = { method: 'GET', pathname: '/', handlerType: 'router' as const, cookieHeader: null }

  test('mutates a normal response in place and keeps its body', async () => {
    const res = new Response('<!doctype html><p>hi</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
    const out = withFinalHeaders(req, res, prodCfg)
    expect(out).toBe(res)
    expect(out.headers.get('cache-control')).toBe(PUBLIC_HTML_CACHE)
    expect(out.headers.get('content-security-policy')).toBe(buildCsp(prodCfg))
    expect(out.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(await out.text()).toBe('<!doctype html><p>hi</p>')
  })

  test('rebuilds responses with immutable headers', () => {
    // Bun's own Response.redirect/fetch headers are mutable; simulate the guarded kind other runtimes use
    const res = new Response(null, { status: 302, headers: { location: 'https://chaochi.example/packs/x' } })
    const guarded = new Headers(res.headers)
    Object.defineProperty(guarded, 'set', {
      value: () => {
        throw new TypeError('immutable')
      },
    })
    Object.defineProperty(res, 'headers', { value: guarded })
    const out = withFinalHeaders(req, res, devCfg)
    expect(out).not.toBe(res)
    expect(out.status).toBe(302)
    expect(out.headers.get('location')).toBe('https://chaochi.example/packs/x')
    expect(out.headers.get('cache-control')).toBe('no-store')
    expect(out.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('keeps a route-specific CSP', () => {
    const res = new Response('x', { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'" } })
    expect(withFinalHeaders(req, res, devCfg).headers.get('content-security-policy')).toBe("default-src 'none'")
  })

  test('downgrades a Set-Cookie page response', () => {
    const res = new Response('x', { headers: { 'content-type': 'text/html', 'set-cookie': 'a=b; Path=/' } })
    expect(withFinalHeaders(req, res, devCfg).headers.get('cache-control')).toBe(PRIVATE_NO_STORE)
  })
})
