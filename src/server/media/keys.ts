import { EMOJI_ID_RE, PACK_KEY_RE } from '#/shared/ids'

// Object key layout in bucket `wuwa` (docs/ARCHITECTURE.md §3). Objects are never moved; derived keys
// can be computed from (storagePackKey, emojiId, variantRev) without a lookup.

export type Variant = 'p240' | 'a160' | 'full'
export type ReviewVariant = 'p240' | 'a160'
export const VARIANTS: readonly Variant[] = ['p240', 'a160', 'full']

export function originalKey(packKey: string, emojiId: string, ext: string): string {
  return `assets/v1/packs/${packKey}/emojis/${emojiId}.${ext}`
}

export function derivedKey(variant: Variant, packKey: string, emojiId: string, rev: number): string {
  return `derived/v1/${variant}/${packKey}/${emojiId}.r${rev}.webp`
}

export function reviewKey(variant: ReviewVariant, packKey: string, emojiId: string): string {
  return `review/v1/${variant}/${packKey}/${emojiId}.webp`
}

export function zipKey(packKey: string, hash8: string): string {
  return `zips/v1/packs/${packKey}/${packKey}.${hash8}.zip`
}

export function uploadTmpKey(uploadId: string, filename: string, now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
  return `uploads/tmp/${y}/${m}/${d}/${uploadId}/${safe}`
}

export function backupKey(now = new Date()): string {
  const iso = now.toISOString()
  return `backups/postgres/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.replace(/[:.]/g, '-')}.dump`
}

// ---- public URLs ----

export interface ImgRef {
  variant: Variant
  packKey: string
  emojiId: string
  rev: number
}

export function imgUrl(ref: ImgRef): string {
  return `/img/v1/${ref.variant}/${ref.packKey}/${ref.emojiId}.r${ref.rev}.webp`
}

export function reviewImgUrl(variant: ReviewVariant, packKey: string, emojiId: string): string {
  return `/review-img/v1/${variant}/${packKey}/${emojiId}.webp`
}

const IMG_PATH_RE = /^\/img\/v1\/(p240|a160|full)\/([^/]+)\/([^/]+)\.r([1-9][0-9]{0,8})\.webp$/

/** Strictly parse an /img path. Anything that is not a canonical derived URL returns null. */
export function parseImgPath(pathname: string): ImgRef | null {
  const m = IMG_PATH_RE.exec(pathname)
  if (!m) return null
  const [, variant, packKey, emojiId, rev] = m
  if (!PACK_KEY_RE.test(packKey!) || !EMOJI_ID_RE.test(emojiId!)) return null
  return { variant: variant as Variant, packKey: packKey!, emojiId: emojiId!, rev: Number(rev) }
}

const REVIEW_PATH_RE = /^\/review-img\/v1\/(p240|a160)\/([^/]+)\/([^/]+)\.webp$/

export function parseReviewImgPath(pathname: string): { variant: ReviewVariant; packKey: string; emojiId: string } | null {
  const m = REVIEW_PATH_RE.exec(pathname)
  if (!m) return null
  const [, variant, packKey, emojiId] = m
  if (!PACK_KEY_RE.test(packKey!) || !EMOJI_ID_RE.test(emojiId!)) return null
  return { variant: variant as ReviewVariant, packKey: packKey!, emojiId: emojiId! }
}
