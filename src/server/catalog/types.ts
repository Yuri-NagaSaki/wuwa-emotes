// Public catalog DTOs: the contract between src/server/catalog and the page lanes.
//
// Rules every DTO follows:
// - Plain JSON: no Date objects (timestamps are ISO-8601 strings), no undefined (absent = null).
// - Viewer independent: the same object is rendered into shared-cached anonymous HTML, so nothing here
//   depends on who is asking (no "isFavorited"); per-viewer state is fetched separately.
// - Only public content ever appears (sql.ts): an emoji is public when it is published AND its web
//   derivatives are ready (emojis.derived_ready), a pack when it is published AND holds at least one
//   public emoji. Counts, covers and minis use public emojis only; a pack whose derivatives are still
//   being generated is hidden everywhere (its detail page is missing). Characters, artists, tags and
//   collections appear only when they have public content.
// - Image fields are ready-to-use /img URLs (docs/ARCHITECTURE.md §2.2, §4).
//
// This file must stay type-only: client code imports it.

import type { ArtistRole, PackKind, SourceKind, TagDimension } from '../db/schema/catalog'

export type { ArtistRole, PackKind, SourceKind, TagDimension }

/** ISO-8601 timestamp, e.g. "2026-10-20T08:38:00.123Z". */
export type IsoDate = string

export type PackSort = 'hot' | 'new' | 'fav' | 'random'
export type StreamSort = 'new' | 'random'
export type EmojiType = 'animated' | 'static'

/** One page of a cursor-paginated list. Pass `nextCursor` back unchanged to get the next page. */
export interface Page<T> {
  items: T[]
  /** Opaque; null on the last page. */
  nextCursor: string | null
  /** The random-order seed in use (sort = random), for shareable URLs; null for other sorts. */
  seed: string | null
}

/**
 * One emoji's images. `width`/`height` are the original pixel size (1:1 at 300 px when the worker has
 * not probed the file yet), so grids and masonry can reserve space before any image loads.
 */
export interface EmojiImage {
  /** r- + 20 hex */
  id: string
  /** Static WebP poster, longest edge 240: /img/v1/p240/<packKey>/<id>.r<rev>.webp */
  poster: string
  /** Animated WebP preview (longest edge 160); only when frames > 1, otherwise null. */
  preview: string | null
  /** Full-size WebP for the single-emoji dialog: /img/v1/full/<packKey>/<id>.r<rev>.webp */
  full: string
  width: number
  height: number
  frames: number
}

export interface CharacterRef {
  slug: string
  name: string
  /** characters.theme_color as stored (a palette name or CSS color); null when unset. */
  color: string | null
}

export interface ArtistRef {
  slug: string
  name: string
}

export interface TagRef {
  dimension: TagDimension
  slug: string
  name: string
}

export type TagsByDimension = Record<TagDimension, TagRef[]>

// ---- packs ----

/** Card in grids and masonry (目录、首页、角色页、画师页、搜索). */
export interface PackCard {
  id: number
  slug: string
  title: string
  excerpt: string | null
  kind: PackKind
  sourceKind: SourceKind
  pinLevel: number
  memorial: boolean
  /** 「允许下载」; false = preview only (official packs are always false). */
  downloadable: boolean
  /** Public emojis in the pack. */
  count: number
  downloads: number
  favorites: number
  publishedAt: IsoDate
  /** Theme color of the first character (by characters.sort, id); null when none. */
  accent: string | null
  /** packs.cover_emoji_id when it is a public emoji of this pack, else the first public emoji. */
  cover: EmojiImage | null
  /** Up to 3 further emojis in pack order (cover excluded). */
  minis: EmojiImage[]
  characters: CharacterRef[]
  /** pack_artists rows with role = artist (commissioners are only on the detail page). */
  artists: ArtistRef[]
}

export interface PackEmoji extends EmojiImage {
  /** 0-based position in the pack (same index emojiPermalink returns). */
  index: number
  /** Original file format: gif | png | webp … */
  format: string
  /** Original file size in bytes (what 保存原图 downloads). */
  bytes: number
  durationMs: number | null
  dominantColor: string | null
  /** Per-emoji character tags (emoji_characters). */
  characters: CharacterRef[]
}

export interface PackNeighbor {
  slug: string
  title: string
  cover: EmojiImage | null
}

export interface PackDetail {
  id: number
  slug: string
  title: string
  excerpt: string | null
  descriptionMd: string | null
  kind: PackKind
  sourceKind: SourceKind
  license: string
  downloadable: boolean
  pinLevel: number
  memorial: boolean
  count: number
  downloads: number
  favorites: number
  publishedAt: IsoDate
  updatedAt: IsoDate
  accent: string | null
  cover: EmojiImage | null
  /** Every public emoji, in pack order (sort_order, created_at, id). */
  emojis: PackEmoji[]
  characters: CharacterRef[]
  /** pack_artists role = artist */
  artists: ArtistRef[]
  /** pack_artists role = commissioner (约稿人 with an artist page) */
  commissioners: ArtistRef[]
  /** packs.commissioner: free-text 约稿 credit, shown as is; may duplicate a commissioner entry. */
  commissionerText: string | null
  creditsText: string | null
  tags: TagsByDimension
  /** Publication order: prev = the pack published just before this one, next = just after. */
  prev: PackNeighbor | null
  next: PackNeighbor | null
}

export type PackLookup = { kind: 'pack'; pack: PackDetail } | { kind: 'redirect'; redirectTo: string } | { kind: 'missing' }

/** /e/:emojiId → which pack page to render and which emoji to open. */
export interface EmojiPermalink {
  emojiId: string
  packSlug: string
  /** 0-based index into PackDetail.emojis */
  index: number
}

/** Emoji in cross-pack streams (画廊、角色「全部表情」、探索). */
export interface EmojiTile extends EmojiImage {
  format: string
  bytes: number
  pack: { slug: string; title: string; downloadable: boolean }
}

/** A sticker in the 打包清单 (tray and /batch): what to show and how to group it. */
export interface BatchItem extends EmojiImage {
  format: string
  /** original size in bytes */
  bytes: number
  /** 0-based position in its pack */
  index: number
  pack: { slug: string; title: string; downloadable: boolean }
}

// ---- characters / artists ----

/** Official portrait (立绘), 3:4 WebP served from /img/v1/portrait/. */
export interface CharacterPortrait {
  /** 240 px wide variant */
  src: string
  /** every stored width, e.g. "…-240.webp 240w, …-480.webp 480w" */
  srcSet: string
  /** size of the largest stored variant (3:4) */
  width: number
  height: number
}

/**
 * A listed character. 张 and 包 follow the attribution rule in catalog/attribution.ts: a sticker
 * belongs to a character through its own tags, or through its pack when the pack has exactly one
 * character. Characters without attributed public stickers are not listed anywhere.
 */
export interface CharacterCard extends CharacterRef {
  /**
   * A public sticker of this character alone, never shared with another character (also not by image
   * hash): characters.avatar_emoji_id when public and free, else one from its most downloaded pack.
   * null when there is none; show a placeholder (initial on the character color), never other art.
   */
  avatar: EmojiImage | null
  /** characters.portrait_key as a portrait; null when none was imported. */
  portrait: CharacterPortrait | null
  /** Public packs holding at least one sticker attributed to the character (包). */
  packCount: number
  /** Public stickers attributed to the character (张). */
  emojiCount: number
  /** Newest publication among those packs. */
  latestAt: IsoDate | null
}

export interface CharacterProfile extends CharacterCard {
  aliases: string[]
}

export interface ArtistLink {
  label: string
  /** http(s) only; other schemes are dropped. */
  url: string
}

export interface ArtistCard extends ArtistRef {
  links: ArtistLink[]
  /** Published packs in any role. */
  packCount: number
  /** …as artist */
  drawnCount: number
  /** …as commissioner */
  commissionedCount: number
  /** Published emojis in those packs. */
  emojiCount: number
  latestAt: IsoDate | null
}

export interface ArtistProfile extends ArtistCard {
  aliases: string[]
}

/** An entity with a published-pack count (facets, 「画师」tab on a character page, …). */
export interface CountedRef {
  slug: string
  name: string
  packCount: number
}

export interface CharacterArtist extends ArtistRef {
  /** Published packs of this character drawn by the artist. */
  packCount: number
}

interface CharacterDetailBase {
  kind: 'character'
  character: CharacterProfile
  /** Artists of this character's packs, most packs first. */
  artists: CharacterArtist[]
}

export type CharacterDetail =
  | (CharacterDetailBase & { tab: 'packs'; page: Page<PackCard> })
  | (CharacterDetailBase & { tab: 'emojis'; page: Page<EmojiTile> })

/**
 * redirect: an old slug (permanent), or a character that appears in public packs without stickers of
 * its own (temporary, to a search for its name: it is not listed, but links to it keep working).
 */
export type CharacterLookup = CharacterDetail | { kind: 'redirect'; redirectTo: string; temporary?: true } | { kind: 'missing' }

export interface ArtistDetail {
  kind: 'artist'
  artist: ArtistProfile
  /** Characters across the artist's published packs, most packs first. */
  characters: (CharacterRef & { packCount: number })[]
  page: Page<PackCard>
}

export type ArtistLookup = ArtistDetail | { kind: 'redirect'; redirectTo: string } | { kind: 'missing' }

// ---- home / explore ----

export interface CatalogStats {
  packs: number
  emojis: number
  /** Listed characters (with attributed public stickers, see CharacterCard). */
  characters: number
  /** Published emojis that went public today (Asia/Shanghai day). See home.ts for the rule. */
  todayEmojis: number
  /** Sum of packs.download_count over published packs. */
  downloads: number
}

export interface CollectionRef {
  slug: string
  title: string
  description: string | null
}

export interface HomeData {
  /** Newest packs (sort = new). */
  latest: PackCard[]
  /** pin_level > 0, highest first. */
  pinned: PackCard[]
  /** The first published collection (by collections.sort) that has published packs; null if none. */
  featuredCollection: CollectionRef | null
  /** Its packs in collection order. */
  featured: PackCard[]
  /** Top characters by attributed sticker count that have an avatar (角色潮汐). */
  characters: CharacterCard[]
  stats: CatalogStats
}

export interface Facets {
  characters: CountedRef[]
  artists: CountedRef[]
  tags: Record<TagDimension, CountedRef[]>
  kinds: { kind: PackKind; packCount: number }[]
  sources: { sourceKind: SourceKind; packCount: number }[]
}

/** Filter-bar facets of /packs: counts over public packs, characters with avatar and color. */
export interface PackFacets {
  /** Public packs in total (the "全部 N 个" line). */
  total: number
  characters: (CountedRef & { color: string | null; avatar: string | null })[]
  artists: CountedRef[]
  tags: Record<TagDimension, CountedRef[]>
  kinds: { kind: PackKind; packCount: number }[]
  sources: { sourceKind: SourceKind; packCount: number }[]
}

/** /packs loader: the first page and the facets in one round trip. */
export interface PacksPageData {
  page: Page<PackCard>
  facets: PackFacets
}

/** /e/:emojiId loader: the permalink and its pack in one round trip. */
export interface EmojiPageData {
  link: EmojiPermalink
  pack: PackDetail
}

export interface ExploreData {
  /** A different random pick on every call. */
  randomPack: PackCard | null
  randomEmoji: EmojiTile | null
  /** Stable for the whole Asia/Shanghai day. */
  today: { day: string; packs: PackCard[]; emojis: EmojiTile[] }
  facets: Facets
}

// ---- search ----

export interface TagHit extends TagRef {
  packCount: number
}

export interface SearchResult {
  /** The normalized query actually searched. */
  q: string
  /** Character or artist whose name or alias equals / starts with the query (最佳匹配卡). */
  best: { type: 'character'; character: CharacterCard } | { type: 'artist'; artist: ArtistCard } | null
  characters: CharacterCard[]
  artists: ArtistCard[]
  packs: PackCard[]
  tags: TagHit[]
  /** Total matches per group (lists above are capped at `limit`). */
  counts: { characters: number; artists: number; packs: number; tags: number }
}

export type SuggestionType = 'character' | 'artist' | 'pack' | 'tag'

/** Command-palette item, served from an in-process index. */
export interface Suggestion {
  type: SuggestionType
  /** entity slug; for tags "<dimension>:<slug>" (tag slugs are unique per dimension only) */
  slug: string
  label: string
  /** Secondary line, e.g. "1,640 张 · 39 包" or the matched alias. */
  sub: string | null
  href: string
  /** p240 poster (avatar / cover); null for artists and tags. */
  image: string | null
  color: string | null
}

// ---- legacy ----

export interface LegacyRedirect {
  location: string
  status: 301 | 302 | 307 | 308
}
