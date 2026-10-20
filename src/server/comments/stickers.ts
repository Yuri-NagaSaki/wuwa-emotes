import { sql } from 'drizzle-orm'
import { EMOJI_ID_RE } from '#/shared/ids'
import { rows } from '../catalog/sql'
import { imgUrl } from '../media/keys'
import { posterSize } from './render'
import type { Sticker } from './types'

// Stickers usable in comments: the emoji is published, its pack is published, and the derived WebPs
// exist (derived_ready), so the p240 poster resolves. The picker sources below use the same filter,
// so the picker never offers a sticker the server would reject.

const USABLE = sql.raw(`e.status = 'published' and p.status = 'published' and e.derived_ready`)
const STICKER_COLS = sql.raw(`e.id, e.storage_pack_key as k, e.variant_rev as r, e.width as w, e.height as h`)
const ORDER = sql.raw(`e.sort_order, e.created_at, e.id`)

interface StickerRow {
  id: string
  k: string
  r: number
  w: number | null
  h: number | null
}

const UNKNOWN = 300

function toSticker(r: StickerRow): Sticker {
  const known = r.w != null && r.h != null && r.w > 0 && r.h > 0
  const size = posterSize(known ? Number(r.w) : UNKNOWN, known ? Number(r.h) : UNKNOWN)
  return { id: r.id, poster: imgUrl({ variant: 'p240', packKey: r.k, emojiId: r.id, rev: Number(r.r) }), ...size }
}

/** Usable stickers among `ids` (unknown, unpublished, hidden or not yet derived ids are absent). */
export async function lookupStickers(ids: readonly string[]): Promise<Map<string, Sticker>> {
  const valid = [...new Set(ids)].filter((id) => EMOJI_ID_RE.test(id))
  if (!valid.length) return new Map()
  const found = await rows<StickerRow>(sql`
    select ${STICKER_COLS}
    from emojis e join packs p on p.id = e.pack_id
    where e.id = any(${sql.param(valid)}::text[]) and ${USABLE}`)
  return new Map(found.map((r) => [r.id, toSticker(r)]))
}

export async function packStickers(by: { packId: number } | { slug: string }, limit = 400): Promise<Sticker[]> {
  const where = 'packId' in by ? sql`p.id = ${by.packId}` : sql`p.slug = ${by.slug}`
  const found = await rows<StickerRow>(sql`
    select ${STICKER_COLS}
    from emojis e join packs p on p.id = e.pack_id
    where ${where} and ${USABLE}
    order by ${ORDER}
    limit ${limit}`)
  return found.map(toSticker)
}

/** Stickers tagged with a character (emoji_characters), most downloaded packs first. */
export async function characterStickers(slug: string, limit = 60): Promise<Sticker[]> {
  const found = await rows<StickerRow>(sql`
    select ${STICKER_COLS}
    from characters c
    join emoji_characters ec on ec.character_id = c.id
    join emojis e on e.id = ec.emoji_id
    join packs p on p.id = e.pack_id
    where c.slug = ${slug} and ${USABLE}
    order by p.download_count desc, p.id, ${ORDER}
    limit ${limit}`)
  return found.map(toSticker)
}

/** The given ids that are usable, in the given order (最近使用 re-validated). */
export async function stickersByIds(ids: readonly string[]): Promise<Sticker[]> {
  const map = await lookupStickers(ids)
  return ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []))
}
