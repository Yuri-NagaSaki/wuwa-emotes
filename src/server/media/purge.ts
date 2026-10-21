import { env } from '../env'
import { log } from '../log'
import { avatarKey, derivedKey, parseAvatarPath, parseImgPath, parsePortraitPath, portraitKey, publicImgBase, publicObjectUrl } from './keys'

// Cloudflare cache purge by URL (docs/ARCHITECTURE.md §6.3). Web images are cached for a year as
// immutable, so deleting R2 objects alone leaves takedowns visible on the CDN. Each deleted image has two
// cached URLs: the origin's /img URL and, with PUBLIC_IMG_BASE set, the bucket's public URL (a custom
// domain in the same zone, so the same token purges both). The token has only the Zone › Cache Purge
// permission. Without CF_ZONE_ID / CF_PURGE_TOKEN this logs a warning and does nothing (development).

export const PURGE_BATCH = 30

export interface PurgeOptions {
  zoneId?: string
  token?: string
  fetch?: typeof fetch
  /** origin used for relative paths; defaults to SITE_URL */
  origin?: string
  /** public image base; defaults to PUBLIC_IMG_BASE ('' = none) */
  publicBase?: string
}

/**
 * Every CDN URL of the given /img URLs or paths: the absolute /img URL itself, plus the public URL of the
 * same object when a public base is set. Other URLs pass through unchanged. Deduplicated, in order.
 */
export function cdnUrls(urls: readonly string[], origin: string, publicBase: string): string[] {
  const out = new Set<string>()
  const site = origin.replace(/\/+$/, '')
  for (const u of urls) {
    const abs = u.startsWith('/') ? site + u : u
    out.add(abs)
    let pathname: string
    try {
      pathname = new URL(abs).pathname
    } catch {
      continue
    }
    const ref = parseImgPath(pathname)
    const portrait = ref ? null : parsePortraitPath(pathname)
    const avatar = ref || portrait ? null : parseAvatarPath(pathname)
    const key = ref
      ? derivedKey(ref.variant, ref.packKey, ref.emojiId, ref.rev)
      : portrait
        ? portraitKey(portrait)
        : avatar
          ? avatarKey(avatar.userId, avatar.hash, avatar.size)
          : null
    const pub = key ? publicObjectUrl(key, publicBase) : null
    if (pub) out.add(pub)
  }
  return [...out]
}

export async function purgeImgUrls(urls: string[], opts: PurgeOptions = {}): Promise<{ purged: number; skipped: boolean }> {
  const list = cdnUrls(urls, opts.origin ?? env().SITE_URL, opts.publicBase ?? publicImgBase())
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
