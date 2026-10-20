import type { ArtistRef, CharacterRef, EmojiImage, EmojiTile, PackCard, PackDetail, PackEmoji } from '#/server/catalog/types'
import type { FlagKind } from '../Chip'
import { type CoverVariant, packCardShape, type PackCardProps } from '../PackCard'
import type { Shape } from '../masonry-layout'

// Catalog DTOs → UI kit props. Pure (no React), shared by every page.

/** The design palette (tokens.css --c-*), in the prototype's order. */
const PALETTE_ORDER = ['pink', 'purple', 'blue', 'yellow', 'orange', 'mint', 'green', 'red', 'lime', 'yg', 'brown', 'peach', 'teal'] as const
const PALETTE = new Set<string>(PALETTE_ORDER)
const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/]+\))$/i

/** characters.theme_color (a palette name or a CSS color) → a CSS color; unknown values fall back. */
export function themeColor(c: string | null | undefined, fallback = 'var(--c-mint)'): string {
  if (!c) return fallback
  const v = c.trim().toLowerCase()
  if (PALETTE.has(v)) return `var(--c-${v})`
  return CSS_COLOR.test(v) ? v : fallback
}

/**
 * A stable palette color for a character (or any other key) without a theme color: the prototype's
 * 31-hash over the key's code points, into the 13 design colors. Same result on server and client.
 */
export function paletteColor(key: string): string {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return `var(--c-${PALETTE_ORDER[h % PALETTE_ORDER.length]})`
}

/** A character's color: its theme_color when set, otherwise the palette pick for its slug. */
export function characterColor(c: { slug: string; color: string | null }): string {
  return themeColor(c.color, paletteColor(c.slug))
}

const enc = encodeURIComponent
export const packHref = (slug: string) => `/packs/${enc(slug)}`
export const characterHref = (slug: string) => `/characters/${enc(slug)}`
export const artistHref = (slug: string) => `/artists/${enc(slug)}`
export const emojiHref = (id: string) => `/e/${id}`
/** /packs filtered by a tag (分组 has its own parameter). */
export const tagHref = (dimension: string, slug: string) =>
  dimension === 'group' ? `/packs?group=${enc(slug)}` : `/packs?tag=${enc(`${dimension}:${slug}`)}`

/** "MM-DD" in Asia/Shanghai, computed the same way on the server and in the browser. */
export function shortDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t + 8 * 3600_000).toISOString().slice(5, 10)
}

/** "YYYY-MM-DD" in Asia/Shanghai. */
export function longDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 10)
}

const VARIANTS: CoverVariant[] = ['four', 'lead', 'one', 'strip']

export interface CardOptions {
  variant?: CoverVariant
  isNew?: boolean
  noExcerpt?: boolean
}

export function cardImages(card: Pick<PackCard, 'cover' | 'minis'>): string[] {
  return [card.cover, ...card.minis].filter((x): x is EmojiImage => !!x).map((x) => x.poster)
}

export function cardFlags(card: Pick<PackCard, 'sourceKind' | 'pinLevel' | 'memorial' | 'kind'>, isNew = false): FlagKind[] {
  const f: FlagKind[] = []
  if (card.sourceKind === 'official') f.push('official')
  if (card.pinLevel > 0) f.push('pin')
  if (card.memorial) f.push('memorial')
  if (isNew) f.push('new')
  if (card.kind === 'static') f.push('static')
  return f
}

/** A pack's accent: its first character's color (server `accent`), else the palette pick for the pack. */
export function packAccent(p: { slug: string; accent: string | null; characters: readonly CharacterRef[] }): string {
  const first = p.characters[0]
  return first ? characterColor(first) : themeColor(p.accent, paletteColor(p.slug))
}

/** PackCard props for a catalog card; the cover layout cycles like the prototype. */
export function cardProps(card: PackCard, index: number, o: CardOptions = {}): PackCardProps {
  return {
    href: packHref(card.slug),
    title: card.title,
    excerpt: card.excerpt,
    count: card.count,
    accent: packAccent(card),
    images: cardImages(card),
    coverPreview: card.cover?.preview ?? null,
    variant: o.variant ?? VARIANTS[index % VARIANTS.length],
    flags: cardFlags(card, o.isNew),
    characters: card.characters.map((c) => ({ name: c.name, color: characterColor(c) })),
    downloads: card.downloads,
    favorites: card.favorites,
    date: shortDate(card.publishedAt),
    artists: card.artists.map((a) => a.name),
    official: card.sourceKind === 'official',
    noExcerpt: o.noExcerpt,
  }
}

export function cardShape(card: PackCard, index: number, o: CardOptions = {}): Shape {
  return packCardShape(cardProps(card, index, o))
}

// ---- the single-emoji dialog ----

export interface DialogPack {
  slug: string
  title: string
  downloadable: boolean
  license: string | null
  artists: ArtistRef[]
  characters: CharacterRef[]
}

/** One sticker as the dialog shows it (pack pages, or cross-pack streams such as 画廊). */
export interface DialogEmoji extends EmojiImage {
  format: string
  bytes: number
  characters: CharacterRef[]
  pack: DialogPack
}

export function dialogPack(p: PackDetail): DialogPack {
  return { slug: p.slug, title: p.title, downloadable: p.downloadable, license: p.license, artists: p.artists, characters: p.characters }
}

export function fromPackEmoji(e: PackEmoji, pack: DialogPack): DialogEmoji {
  return {
    id: e.id,
    poster: e.poster,
    preview: e.preview,
    full: e.full,
    width: e.width,
    height: e.height,
    frames: e.frames,
    format: e.format,
    bytes: e.bytes,
    characters: e.characters.length ? e.characters : pack.characters,
    pack,
  }
}

export function fromTile(t: EmojiTile): DialogEmoji {
  return {
    id: t.id,
    poster: t.poster,
    preview: t.preview,
    full: t.full,
    width: t.width,
    height: t.height,
    frames: t.frames,
    format: t.format,
    bytes: t.bytes,
    characters: [],
    pack: { slug: t.pack.slug, title: t.pack.title, downloadable: t.pack.downloadable, license: null, artists: [], characters: [] },
  }
}

/** Human license line: the CC badge text and a short gloss. */
export function licenseLabel(license: string | null | undefined): { badge: string | null; text: string } {
  const l = (license ?? '').trim()
  if (!l || l === 'unknown') return { badge: null, text: '许可未注明，请勿商用或再分发' }
  if (/^CC BY-NC-SA/i.test(l)) return { badge: l, text: '署名 · 非商业 · 相同方式共享' }
  if (/^CC BY-NC/i.test(l)) return { badge: l, text: '署名 · 非商业' }
  if (/^CC BY/i.test(l)) return { badge: l, text: '署名' }
  if (/official|官方/i.test(l)) return { badge: null, text: '官方作品，版权归库洛游戏所有' }
  return { badge: null, text: l }
}

export { KIND_LABEL, SOURCE_LABEL } from './labels'
