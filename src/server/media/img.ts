import { derivedKey, imgUrl, parseImgPath, type ImgRef } from './keys'

// /img: the only public path to images. Reads derived/v1/ only, for published emojis only.
// Hits need no database lookup; a missing `full` variant is the one case that checks the database,
// so nobody can push a pending (unreviewed) image into derived/ by guessing its URL.

export const IMMUTABLE = 'public, max-age=31536000, immutable'
const MISS_CACHE = 'public, max-age=60'

export interface ImgObject {
  body: ReadableStream | null
  contentLength?: number
  etag?: string
  notModified?: boolean
}

export interface EmojiForFull {
  status: string
  packStatus: string
  storagePackKey: string
  variantRev: number
  frames: number
}

export interface ImgDeps {
  getObject(key: string, ifNoneMatch?: string): Promise<ImgObject | null>
  lookupEmoji(emojiId: string): Promise<EmojiForFull | null>
  enqueueFull(emojiId: string): Promise<void>
}

const baseHeaders = { 'x-content-type-options': 'nosniff' }

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { ...baseHeaders, 'cache-control': MISS_CACHE, 'content-type': 'text/plain' } })
}

export function canGenerateFull(ref: ImgRef, row: EmojiForFull | null): boolean {
  return (
    !!row &&
    row.status === 'published' &&
    row.packStatus === 'published' &&
    row.storagePackKey === ref.packKey &&
    row.variantRev === ref.rev
  )
}

export async function handleImg(request: Request, deps: ImgDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...baseHeaders, 'content-type': 'text/plain', allow: 'GET, HEAD' } })
  }
  const ref = parseImgPath(new URL(request.url).pathname)
  if (!ref) return notFound()

  const started = performance.now()
  const obj = await deps.getObject(derivedKey(ref.variant, ref.packKey, ref.emojiId, ref.rev), request.headers.get('if-none-match') ?? undefined)
  // time to the bucket's response headers: a CDN miss shows where its time went (cached hits repeat
  // the value of the miss that filled the cache)
  const timing = { 'server-timing': `s3;dur=${Math.round(performance.now() - started)}` }
  if (obj?.notModified) {
    return new Response(null, { status: 304, headers: { ...baseHeaders, ...timing, 'cache-control': IMMUTABLE, ...(obj.etag ? { etag: obj.etag } : {}) } })
  }
  if (obj) {
    const headers: Record<string, string> = { ...baseHeaders, ...timing, 'content-type': 'image/webp', 'cache-control': IMMUTABLE }
    if (obj.etag) headers.etag = obj.etag
    if (obj.contentLength != null) headers['content-length'] = String(obj.contentLength)
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers })
  }

  if (ref.variant === 'full') {
    const row = await deps.lookupEmoji(ref.emojiId)
    if (canGenerateFull(ref, row)) {
      await deps.enqueueFull(ref.emojiId)
      // a160 exists only for animated emojis; static ones fall back to the poster
      const fallback = row!.frames > 1 ? 'a160' : 'p240'
      return new Response(null, {
        status: 302,
        headers: { ...baseHeaders, location: imgUrl({ ...ref, variant: fallback }), 'cache-control': 'no-store' },
      })
    }
  }
  return notFound()
}
