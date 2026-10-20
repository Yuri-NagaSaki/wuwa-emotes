import { env } from '../env'
import { log } from '../log'

// Cloudflare cache purge by URL (docs/ARCHITECTURE.md §6.3). /img responses are cached for a year as
// immutable, so deleting R2 objects alone leaves takedowns visible on the CDN. The worker holds a token
// with only the Zone › Cache Purge permission. Without CF_ZONE_ID / CF_PURGE_TOKEN this logs a warning
// and does nothing (development).

export const PURGE_BATCH = 30

export interface PurgeOptions {
  zoneId?: string
  token?: string
  fetch?: typeof fetch
  /** origin used for relative paths; defaults to SITE_URL */
  origin?: string
}

export async function purgeImgUrls(urls: string[], opts: PurgeOptions = {}): Promise<{ purged: number; skipped: boolean }> {
  const origin = (opts.origin ?? env().SITE_URL).replace(/\/+$/, '')
  const list = [...new Set(urls.map((u) => (u.startsWith('/') ? origin + u : u)))]
  if (!list.length) return { purged: 0, skipped: false }
  const zoneId = opts.zoneId ?? env().CF_ZONE_ID
  const token = opts.token ?? env().CF_PURGE_TOKEN
  if (!zoneId || !token) {
    log().warn({ count: list.length }, 'purge: CF_ZONE_ID / CF_PURGE_TOKEN not set; CDN copies stay cached until they expire')
    return { purged: 0, skipped: true }
  }
  const doFetch = opts.fetch ?? fetch
  let purged = 0
  for (let i = 0; i < list.length; i += PURGE_BATCH) {
    const files = list.slice(i, i + PURGE_BATCH)
    const res = await doFetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: unknown } | null
    if (!res.ok || !body?.success) {
      throw new Error(`Cloudflare purge failed (HTTP ${res.status}): ${JSON.stringify(body?.errors ?? body)}; ${purged} of ${list.length} URLs purged`)
    }
    purged += files.length
  }
  log().info({ purged }, 'purge: CDN URLs purged')
  return { purged, skipped: false }
}
