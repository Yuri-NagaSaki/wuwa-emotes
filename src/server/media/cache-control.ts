import { IMMUTABLE, PUBLIC_IMAGE_PREFIXES } from './keys'
import { headObject, listKeys, replaceObjectHeaders } from './s3'

// `bun src/cli.ts media set-cache-control --prefix derived/v1/ [--dry-run] [--concurrency N]`: give
// existing public web images the headers new ones are written with (one-year immutable Cache-Control and
// their image Content-Type), so the bucket's public domain serves them cacheable without a dashboard
// rule. Each object is copied onto itself (CopyObject, MetadataDirective REPLACE, user metadata kept);
// objects that already have both headers are left alone. Only the public image prefixes are accepted:
// never assets/ (originals), meta/ or sync/ (the read-only v1 snapshot), backups/ or anything else.

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif' }

/** The Content-Type a public image key should have (by extension), or null when unknown. */
export function imageContentType(key: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase()
  return (ext && TYPES[ext]) || null
}

/** A prefix the command may touch: one of the public image prefixes or a path below one. */
export function assertPublicImagePrefix(prefix: string): void {
  if (!prefix.endsWith('/')) throw new Error('--prefix must end with /')
  if (!PUBLIC_IMAGE_PREFIXES.some((p) => prefix.startsWith(p))) {
    throw new Error(`refusing prefix ${prefix}: only ${PUBLIC_IMAGE_PREFIXES.join(', ')} (or a path below one) hold public web images`)
  }
}

export interface SetCacheControlResult {
  scanned: number
  /** both headers already right */
  unchanged: number
  /** rewritten (or, with dryRun, that would be) */
  updated: number
  failed: { key: string; error: string }[]
}

export async function setCacheControl(
  prefix: string,
  opts: { dryRun?: boolean; concurrency?: number; log?: (line: string) => void } = {},
): Promise<SetCacheControlResult> {
  assertPublicImagePrefix(prefix)
  const log = opts.log ?? (() => undefined)
  const keys = await listKeys(prefix)
  const r: SetCacheControlResult = { scanned: keys.length, unchanged: 0, updated: 0, failed: [] }
  let next = 0
  const work = async () => {
    for (;;) {
      const i = next++
      if (i >= keys.length) return
      const key = keys[i]!
      try {
        const head = await headObject(key)
        if (!head) continue // deleted meanwhile
        const type = imageContentType(key) ?? head.ContentType ?? 'application/octet-stream'
        if (head.CacheControl === IMMUTABLE && head.ContentType === type) {
          r.unchanged++
          continue
        }
        if (!opts.dryRun) await replaceObjectHeaders(key, { contentType: type, cacheControl: IMMUTABLE, metadata: head.Metadata, ifMatch: head.ETag })
        r.updated++
        if (r.updated <= 20) log(`${opts.dryRun ? 'would set' : 'set'} ${key}: ${head.ContentType ?? '-'} / ${head.CacheControl ?? '-'} → ${type} / ${IMMUTABLE}`)
      } catch (err) {
        r.failed.push({ key, error: (err as Error).message })
      }
      if ((i + 1) % 1000 === 0) log(`  ${i + 1} of ${keys.length} checked`)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 8, 64)) }, work))
  return r
}
