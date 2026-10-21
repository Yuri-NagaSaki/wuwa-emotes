import { EMOJI_ID_RE, PACK_KEY_RE } from '#/shared/ids'
import { env } from '../env'

// Object key layout in bucket `wuwa` (docs/ARCHITECTURE.md §3). Objects are never moved; derived keys
// can be computed from (storagePackKey, emojiId, variantRev) without a lookup.
// Server only: the URL helpers read PUBLIC_IMG_BASE from env().

export type Variant = 'p240' | 'a160' | 'full'
export type ReviewVariant = 'p240' | 'a160'
export const VARIANTS: readonly Variant[] = ['p240', 'a160', 'full']

export function originalKey(packKey: string, emojiId: string, ext: string): string {
  return `assets/v1/packs/${packKey}/emojis/${emojiId}.${ext}`
}

export function derivedKey(variant: Variant, packKey: string, emojiId: string, rev: number): string {
  return `derived/v1/${variant}/${packKey}/${emojiId}.r${rev}.webp`
}

// ---- character portraits (立绘, import-portraits) ----
//
// characters/v1/portraits/<name>.<hash8>-<w>.webp: 3:4 WebP, w ∈ PORTRAIT_WIDTHS. <name> is the
// character's slug at import time, <hash8> covers the source image and the processing, so a new
// portrait is a new key (immutable caching). characters.portrait_key holds the largest width; every
// smaller width in PORTRAIT_WIDTHS exists too.

export const PORTRAIT_WIDTHS = [240, 480] as const
export type PortraitWidth = (typeof PORTRAIT_WIDTHS)[number]
export const PORTRAIT_PREFIX = 'characters/v1/portraits/'
const PORTRAIT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/

export interface PortraitRef {
  name: string
  hash8: string
  width: PortraitWidth
}

export function isPortraitName(name: string): boolean {
  return PORTRAIT_NAME_RE.test(name) && !name.includes('--')
}

export function portraitKey(ref: PortraitRef): string {
  return `${PORTRAIT_PREFIX}${ref.name}.${ref.hash8}-${ref.width}.webp`
}

/** The origin's path for a portrait (always /img, whatever PUBLIC_IMG_BASE says). */
export function portraitPath(ref: PortraitRef): string {
  return `/img/v1/portrait/${ref.name}.${ref.hash8}-${ref.width}.webp`
}

/** Where a browser loads a portrait from (webImageUrl). */
export function portraitUrl(ref: PortraitRef, base?: string): string {
  return webImageUrl(portraitKey(ref), portraitPath(ref), base)
}

function portraitRef(name: string, hash8: string, width: string): PortraitRef | null {
  const w = Number(width)
  if (!isPortraitName(name) || !(PORTRAIT_WIDTHS as readonly number[]).includes(w)) return null
  return { name, hash8, width: w as PortraitWidth }
}

const PORTRAIT_FILE = '([^/]+)\\.([0-9a-f]{8})-([0-9]{3})\\.webp'
const PORTRAIT_KEY_RE = new RegExp(`^characters/v1/portraits/${PORTRAIT_FILE}$`)
const PORTRAIT_PATH_RE = new RegExp(`^/img/v1/portrait/${PORTRAIT_FILE}$`)

/** A stored portrait_key, or null when it is not a canonical portrait key. */
export function parsePortraitKey(key: string): PortraitRef | null {
  const m = PORTRAIT_KEY_RE.exec(key)
  return m ? portraitRef(m[1]!, m[2]!, m[3]!) : null
}

/** Strictly parse /img/v1/portrait/<name>.<hash8>-<w>.webp. Anything else returns null. */
export function parsePortraitPath(pathname: string): PortraitRef | null {
  const m = PORTRAIT_PATH_RE.exec(pathname)
  return m ? portraitRef(m[1]!, m[2]!, m[3]!) : null
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

// ---- public web images ----
//
// p240, a160, character portraits and avatars are public and immutable (every key carries a revision
// or a content hash). With PUBLIC_IMG_BASE set (the bucket's custom domain, e.g. https://i.sparxie.moe)
// browsers load them straight from the bucket; unset, from the origin's /img, as before. `full` stays on
// /img either way: it is rendered on first open (a 302 to the poster until then). Review images stay on
// /review-img. JavaScript that reads image bytes (clipboard copy on a canvas) uses the /img path, so
// nothing depends on bucket CORS (src/shared/web-image.ts).

export const IMMUTABLE = 'public, max-age=31536000, immutable'
/** Prefixes of the public web images; nothing else may be reachable on PUBLIC_IMG_BASE. */
export const PUBLIC_IMAGE_PREFIXES = ['derived/v1/', PORTRAIT_PREFIX, 'avatars/'] as const

export function isPublicImageKey(key: string): boolean {
  return PUBLIC_IMAGE_PREFIXES.some((p) => key.startsWith(p))
}

/** Cache-Control for a new object: public images are cached for a year; others keep the default. */
export function objectCacheControl(key: string): string | undefined {
  return isPublicImageKey(key) ? IMMUTABLE : undefined
}

/** PUBLIC_IMG_BASE without a trailing slash, or '' when browsers should use /img. */
export function publicImgBase(): string {
  return env().PUBLIC_IMG_BASE
}

/** `${PUBLIC_IMG_BASE}/<key>`, or null when PUBLIC_IMG_BASE is unset. */
export function publicObjectUrl(key: string, base = publicImgBase()): string | null {
  return base ? `${base}/${key}` : null
}

/**
 * The one place that decides where a browser loads a public web image from: the bucket's public base
 * when PUBLIC_IMG_BASE is set, otherwise the origin path. Every web image URL goes through here.
 */
export function webImageUrl(key: string, originPath: string, base = publicImgBase()): string {
  return publicObjectUrl(key, base) ?? originPath
}

// ---- /img URLs ----

export interface ImgRef {
  variant: Variant
  packKey: string
  emojiId: string
  rev: number
}

/** The origin's /img path of a derived image (redirects, CDN purges, same-origin byte reads). */
export function imgPath(ref: ImgRef): string {
  return `/img/v1/${ref.variant}/${ref.packKey}/${ref.emojiId}.r${ref.rev}.webp`
}

/** Where a browser loads a derived image from: p240 and a160 through webImageUrl, `full` from /img. */
export function imgUrl(ref: ImgRef, base?: string): string {
  if (ref.variant === 'full') return imgPath(ref)
  return webImageUrl(derivedKey(ref.variant, ref.packKey, ref.emojiId, ref.rev), imgPath(ref), base)
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
