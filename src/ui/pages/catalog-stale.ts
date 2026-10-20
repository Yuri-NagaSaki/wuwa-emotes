/**
 * How long a public catalog page's loader data counts as fresh in the browser (route `staleTime`).
 * Back/Forward and a click on a link that was preloaded on hover within this window reuse the data
 * instead of fetching it again and rendering the whole page a second time when the copy arrives.
 * The server caches these lists for 30 s too (src/server/catalog/cache.ts), so a refetch inside the
 * window would mostly return the same data. Pages with per-viewer data (/me, /admin) keep the default.
 */
export const CATALOG_STALE_MS = 30_000
