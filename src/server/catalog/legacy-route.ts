import type { LegacyRedirect } from './types'

// The source site's old addresses (docs/ARCHITECTURE.md §2.1): /archives/:slug → /packs/:slug,
// /tags/character-* → /characters/:slug (and the other tag kinds), resolved by resolveLegacyPath().
// A hit is a 301 the CDN may keep for a day; a miss is left to the page router, which renders the
// 404 page. The resolver is injected so the handler is tested without a database.

export const LEGACY_CACHE_CONTROL = 'public, max-age=86400'

export type ResolveLegacy = (path: string) => Promise<LegacyRedirect | null>

/** The redirect response for an old address, or null when there is none (render the 404 page). */
export async function legacyRedirect(request: Request, resolve: ResolveLegacy): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const { pathname } = new URL(request.url)
  const hop = await resolve(pathname)
  if (!hop) return null
  return new Response(null, {
    status: hop.status,
    headers: { location: hop.location, 'cache-control': LEGACY_CACHE_CONTROL },
  })
}
