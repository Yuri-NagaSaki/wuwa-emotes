import { type SQL, sql } from 'drizzle-orm'
import { type CardRow, cardSelect, toPackCard } from './cards'
import { packVisible, PUB_AT, rows } from './sql'
import type { PackCard } from './types'

// 相关推荐 on the pack page: the other public packs (sql.ts), ranked by what they share with this one
//
//   score = 3 × shared artists (pack_artists, role artist)
//         + 2 × shared characters (pack_characters, the relation the cards' characters come from)
//         + 1 × shared tags of the group or project dimension
//
// then most downloaded, newest (published_at, else created_at), id. Packs that share nothing rank by
// the same tail, so when fewer than `limit` packs score, the rest are the most downloaded others. One
// statement; getPackDetail runs it next to its own two, keyed by the slug, so the pack page waits for
// no extra round trip. The cards carry no minis (the aside shows the cover only).

export const RELATED_LIMIT = 10
const MAX_LIMIT = 50

/**
 * Card source for the packs related to the pack `q` matching `target` (a condition on packs q; no
 * such pack: no rows). Columns: id, score, ord.
 */
function relatedSource(target: SQL, limit: number): SQL {
  const order = sql`coalesce(s.score, 0) desc, p.download_count desc, ${PUB_AT} desc, p.id`
  return sql`
    with me as (select q.id from packs q where ${target}),
    hits as (
      select x.pack_id, 3 as w from pack_artists x
        join pack_artists m on m.artist_id = x.artist_id and m.role = 'artist' and m.pack_id = (select id from me)
      where x.role = 'artist'
      union all
      select x.pack_id, 2 from pack_characters x
        join pack_characters m on m.character_id = x.character_id and m.pack_id = (select id from me)
      union all
      select x.pack_id, 1 from pack_tags x
        join pack_tags m on m.tag_id = x.tag_id and m.pack_id = (select id from me)
        join tags t on t.id = x.tag_id and t.dimension in ('group', 'project')
    ),
    scores as (select pack_id, sum(w)::int as score from hits group by pack_id)
    select p.id, coalesce(s.score, 0) as score, row_number() over (order by ${order}) as ord
    from packs p left join scores s on s.pack_id = p.id
    where p.id <> (select id from me) and ${packVisible('p')}
    order by ${order}
    limit ${limit}`
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit) || RELATED_LIMIT))
}

/** The whole statement: card rows of the related packs, best first (exported for EXPLAIN). */
export function relatedSql(target: SQL, limit = RELATED_LIMIT): SQL {
  return sql`${cardSelect(relatedSource(target, clampLimit(limit)))} order by src.ord`
}

/** Targets for relatedSql(): the pack with this id or slug. */
export const packWithId = (id: number): SQL => sql`q.id = ${id}::int`
export const packWithSlug = (slug: string): SQL => sql`q.slug = ${slug}`

async function relatedCards(target: SQL, limit: number): Promise<PackCard[]> {
  const list = await rows<CardRow>(relatedSql(target, limit))
  return list.map((r) => ({ ...toPackCard(r), minis: [] }))
}

/** Up to `limit` public packs related to pack `packId` (never the pack itself), best first; none for an unknown id. */
export function relatedPacks(packId: number, limit = RELATED_LIMIT): Promise<PackCard[]> {
  return relatedCards(packWithId(packId), limit)
}

/** relatedPacks for the pack with this slug, in one statement (empty when no pack has the slug). */
export function relatedPacksBySlug(slug: string, limit = RELATED_LIMIT): Promise<PackCard[]> {
  return relatedCards(packWithSlug(slug), limit)
}
