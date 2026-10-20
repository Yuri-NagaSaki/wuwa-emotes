import { type SQL, sql } from 'drizzle-orm'
import { decodeCursor, encodeCursor, newSeed } from './cursor'
import { type RawImage, toEmojiImage } from './images'
import { galleryInput, type GalleryInput } from './inputs'
import { type KeyCol, keysetAfter, keyTextSql, keyValues, num, orderBySql, PUB_AT, rows, seededHash } from './sql'
import type { EmojiTile, EmojiType, Page, StreamSort } from './types'

// Cross-pack emoji streams: 潮汐画廊 and the 「全部表情」 tab of a character page.
//   new:    newest packs first, each pack in its own order
//   random: seeded hash of the emoji id, seed carried in the cursor
// One statement per page.

export interface StreamFilters {
  /** character slug, matched through emoji_characters (emoji-level tags) */
  character?: string
  type?: EmojiType
}

export function streamKeyCols(sort: StreamSort, seed: string): KeyCol[] {
  if (sort === 'random') {
    return [
      { expr: seededHash(sql.raw('e.id'), seed), desc: false, type: 'bigint' },
      { expr: sql.raw('e.id'), desc: false, type: 'text' },
    ]
  }
  return [
    { expr: PUB_AT, desc: true, type: 'timestamptz' },
    { expr: sql.raw('p.id'), desc: true, type: 'int' },
    { expr: sql.raw('e.sort_order'), desc: false, type: 'int' },
    { expr: sql.raw('e.created_at'), desc: false, type: 'timestamptz' },
    { expr: sql.raw('e.id'), desc: false, type: 'text' },
  ]
}

export interface TileRow extends RawImage {
  format: string
  bytes: number
  pack_slug: string
  pack_title: string
  downloadable: boolean
  [extra: string]: unknown
}

/** Select list for EmojiTile rows (aliases e, p). */
export const TILE_COLUMNS = sql.raw(
  `e.id, e.storage_pack_key as k, e.variant_rev as r, e.width as w, e.height as h, e.frames as f, e.format, e.bytes, ` +
    `p.slug as pack_slug, p.title as pack_title, p.downloadable`,
)

export function toEmojiTile(r: TileRow): EmojiTile {
  return {
    ...toEmojiImage(r),
    format: r.format,
    bytes: num(r.bytes),
    pack: { slug: r.pack_slug, title: r.pack_title, downloadable: !!r.downloadable },
  }
}

function filterSql(f: StreamFilters): SQL[] {
  const out: SQL[] = []
  if (f.character) {
    out.push(sql`exists (select 1 from emoji_characters fc join characters c on c.id = fc.character_id
                         where fc.emoji_id = e.id and c.slug = ${f.character})`)
  }
  if (f.type === 'animated') out.push(sql`e.frames > 1`)
  if (f.type === 'static') out.push(sql`e.frames <= 1`)
  return out
}

export interface StreamOptions {
  sort: StreamSort
  seed?: string
  cursor?: string
  limit: number
}

export async function emojiPage(filters: StreamFilters, opts: StreamOptions): Promise<Page<EmojiTile>> {
  const scope = `emojis:${opts.sort}`
  const cur = opts.cursor ? decodeCursor(opts.cursor, scope, streamKeyCols(opts.sort, '0')) : null
  const seed = opts.sort === 'random' ? (cur?.seed ?? opts.seed ?? newSeed()) : ''
  const cols = streamKeyCols(opts.sort, seed)

  const where = [sql`e.status = 'published'`, sql`p.status = 'published'`, ...filterSql(filters)]
  if (cur) where.push(keysetAfter(cols, cur.keys))
  const list = await rows<TileRow>(sql`
    select ${TILE_COLUMNS}, ${keyTextSql(cols)}
    from emojis e join packs p on p.id = e.pack_id
    where ${sql.join(where, sql` and `)}
    order by ${orderBySql(cols)}
    limit ${opts.limit + 1}`)

  const more = list.length > opts.limit
  const items = more ? list.slice(0, opts.limit) : list
  const last = items[items.length - 1]
  return {
    items: items.map(toEmojiTile),
    nextCursor: more && last ? encodeCursor({ scope, keys: keyValues(last, cols.length), seed: seed || undefined }) : null,
    seed: opts.sort === 'random' ? seed : null,
  }
}

/** 潮汐画廊: every published emoji, newest packs first or in a seeded random order. */
export async function getGallery(input: GalleryInput = {}): Promise<Page<EmojiTile>> {
  const i = galleryInput.parse(input)
  return emojiPage({ character: i.character, type: i.type }, { sort: i.sort, seed: i.seed, cursor: i.cursor, limit: i.limit })
}
