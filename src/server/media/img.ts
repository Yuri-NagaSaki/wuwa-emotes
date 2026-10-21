import { avatarKey, derivedKey, IMMUTABLE, imgPath, type ImgRef, parseAvatarPath, parseImgPath, parsePortraitPath, portraitKey } from './keys'

// /img: the origin's path to web images. Reads derived/v1/ (published emojis only) and
// characters/v1/portraits/ (official character portraits, /img/v1/portrait/…). With PUBLIC_IMG_BASE
// set, pages load p240, a160 and portraits from the bucket's public domain instead; /img keeps serving
// every variant (old links, cached HTML, same-origin byte reads, development).
// Hits need no database lookup; a missing `full` variant is the one case that checks the database,
// so nobody can push a pending (unreviewed) image into derived/ by guessing its URL.

export { IMMUTABLE }

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

/** 304 / 200 for a stored WebP, or null when the object does not exist. */
async function serveObject(request: Request, deps: ImgDeps, key: string): Promise<Response | null> {
  const started = performance.now()
  const obj = await deps.getObject(key, request.headers.get('if-none-match') ?? undefined)
  // time to the bucket's response headers: a CDN miss shows where its time went (cached hits repeat
  // the value of the miss that filled the cache)
  const timing = { 'server-timing': `s3;dur=${Math.round(performance.now() - started)}` }
  if (obj?.notModified) {
    return new Response(null, { status: 304, headers: { ...baseHeaders, ...timing, 'cache-control': IMMUTABLE, ...(obj.etag ? { etag: obj.etag } : {}) } })
  }
  if (!obj) return null
  const headers: Record<string, string> = { ...baseHeaders, ...timing, 'content-type': 'image/webp', 'cache-control': IMMUTABLE }
  if (obj.etag) headers.etag = obj.etag
  if (obj.contentLength != null) headers['content-length'] = String(obj.contentLength)
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers })
}

export async function handleImg(request: Request, deps: ImgDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...baseHeaders, 'content-type': 'text/plain', allow: 'GET, HEAD' } })
  }
  const pathname = new URL(request.url).pathname
  const ref = parseImgPath(pathname)
  if (!ref) {
    // character portraits: characters/v1/portraits/ only; public by nature, so no database lookup
    const portrait = parsePortraitPath(pathname)
    if (portrait) return (await serveObject(request, deps, portraitKey(portrait))) || notFound()
    // user avatars (/img/v1/avatar/…): avatars/v1/<userId>/<hash>-<size>.webp only, content-addressed,
    // so no database lookup either
    const avatar = parseAvatarPath(pathname)
    return (avatar && (await serveObject(request, deps, avatarKey(avatar.userId, avatar.hash, avatar.size)))) || notFound()
  }

  const hit = await serveObject(request, deps, derivedKey(ref.variant, ref.packKey, ref.emojiId, ref.rev))
  if (hit) return hit

  if (ref.variant === 'full') {
    const row = await deps.lookupEmoji(ref.emojiId)
    if (canGenerateFull(ref, row)) {
      await deps.enqueueFull(ref.emojiId)
      // a160 exists only for animated emojis; static ones fall back to the poster. Same origin even with
      // PUBLIC_IMG_BASE: the clipboard draws `full` on a canvas, which a cross-origin redirect would taint.
      const fallback = row!.frames > 1 ? 'a160' : 'p240'
      return new Response(null, {
        status: 302,
        headers: { ...baseHeaders, location: imgPath({ ...ref, variant: fallback }), 'cache-control': 'no-store' },
      })
    }
  }
  return notFound()
}
