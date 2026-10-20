// Short in-process cache for hot, viewer-independent lists (home, characters, artists, facets, the
// suggestion index). Stores the promise, so concurrent misses share one query; failures are evicted.
// Values are shared between callers: treat them as read-only.

export const LIST_TTL_MS = 30_000

interface Entry {
  at: number
  ttl: number
  value: Promise<unknown>
}

const store = new Map<string, Entry>()

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>
  for (const [k, e] of store) if (now - e.at >= e.ttl) store.delete(k)
  const value = load()
  store.set(key, { at: now, ttl: ttlMs, value })
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key)
  })
  return value
}

/** Drop everything (tests, and admin writes that want instant visibility). */
export function clearCatalogCache(): void {
  store.clear()
}
