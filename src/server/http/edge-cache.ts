import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { hasSessionCookie, PUBLIC_FN_CACHE } from './security'

// Shared (CDN) caching for the public catalog server functions: page data that is the same for every
// visitor (src/server/catalog/fns.ts). Called from a handler after its data is ready. Only an anonymous
// GET is marked shareable; a request carrying a session cookie, and anything viewer-specific
// (getPublicConfig, comments, favorites, account), keeps the default `no-store`. The request middleware
// enforces the same rule again on the way out (security.ts, decideCacheControl).

/** Mark this server-function response as cacheable by Cloudflare for 30 s (+ 300 s stale). */
export function allowEdgeCache(): void {
  const req = getRequest()
  if (req.method !== 'GET' || hasSessionCookie(req.headers.get('cookie'))) return
  setResponseHeader('cache-control', PUBLIC_FN_CACHE)
}

/** A list request whose answer depends on the moment (random order without a seed or cursor) is not shared. */
export function isDeterministic(input: { sort?: string; seed?: string; cursor?: string } | undefined): boolean {
  return !(input?.sort === 'random' && !input.seed && !input.cursor)
}
