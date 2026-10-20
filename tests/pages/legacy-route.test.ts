import { describe, expect, test } from 'bun:test'
import { LEGACY_CACHE_CONTROL, legacyRedirect, type ResolveLegacy } from '#/server/catalog/legacy-route'
import { decideCacheControl } from '#/server/http/security'

// The /archives/* and /tags/* server handlers with a stub resolver (the real resolver,
// resolveLegacyPath, is covered by tests/catalog/legacy.test.ts against the database).

const table: Record<string, Awaited<ReturnType<ResolveLegacy>>> = {
  '/archives/emoji-post-aimisi01': { location: '/packs/aimisi-01', status: 301 },
  '/tags/character-aimisi': { location: '/characters/aimisi', status: 301 },
  '/tags/%E4%B8%AD%E6%96%87': { location: '/packs/xin-01', status: 308 },
}
const asked: string[] = []
const resolve: ResolveLegacy = async (path) => {
  asked.push(path)
  return table[path] ?? null
}
const req = (path: string, method = 'GET') => new Request(`https://chaochi.example${path}`, { method })

describe('legacy address redirects', () => {
  test('a known address answers 301 with a day of shared caching', async () => {
    const res = await legacyRedirect(req('/archives/emoji-post-aimisi01?utm_source=x'), resolve)
    expect(res!.status).toBe(301)
    expect(res!.headers.get('location')).toBe('/packs/aimisi-01')
    expect(res!.headers.get('cache-control')).toBe(LEGACY_CACHE_CONTROL)
    expect(LEGACY_CACHE_CONTROL).toBe('public, max-age=86400')
    // the query string is not part of the lookup
    expect(asked.at(-1)).toBe('/archives/emoji-post-aimisi01')
    expect(await res!.text()).toBe('')
  })

  test('HEAD works; the status of a redirects-table row is kept', async () => {
    expect((await legacyRedirect(req('/tags/character-aimisi', 'HEAD'), resolve))!.headers.get('location')).toBe('/characters/aimisi')
    expect((await legacyRedirect(req('/tags/中文'), resolve))!.status).toBe(308)
  })

  test('unknown addresses and other methods fall through (the page router renders the 404)', async () => {
    expect(await legacyRedirect(req('/archives/nothing'), resolve)).toBeNull()
    expect(await legacyRedirect(req('/archives/emoji-post-aimisi01', 'POST'), resolve)).toBeNull()
  })

  test('the security middleware keeps the redirect cacheable for anonymous visitors only', () => {
    const base = { method: 'GET', pathname: '/archives/x', handlerType: 'router' as const, status: 301, contentType: null, cacheControl: LEGACY_CACHE_CONTROL, hasSetCookie: false }
    expect(decideCacheControl({ ...base, cookieHeader: null })).toBeNull()
    expect(decideCacheControl({ ...base, cookieHeader: '__Secure-better-auth.session_token=abc' })).toBe('private, no-store')
  })
})
