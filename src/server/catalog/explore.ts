import { sql } from 'drizzle-orm'
import { artistEntries } from './artists'
import { cached, LIST_TTL_MS } from './cache'
import { type CardRow, cardSelect, toPackCard } from './cards'
import { characterEntries } from './characters'
import { num, rows, seededHash, shanghaiDay } from './sql'
import { TILE_COLUMNS, type TileRow, toEmojiTile } from './stream'
import type { CountedRef, EmojiTile, ExploreData, Facets, PackCard, PackKind, SourceKind, TagDimension } from './types'

// 探索: a random pack and a random emoji (fresh on every call), today's picks (seeded by the
// Asia/Shanghai date, so stable all day) and the facet lists the page links into /packs filters.
// Two statements per call (cards, tiles) plus the cached facets / character / artist lists.

export const TODAY_PACKS = 3
export const TODAY_EMOJIS = 8

const DIMENSIONS: TagDimension[] = ['group', 'tool', 'project', 'origin', 'custom']

async function loadFacetTags(): Promise<Pick<Facets, 'tags' | 'kinds' | 'sources'>> {
  const [r] = await rows<{
    tags: { dimension: TagDimension; slug: string; name: string; n: number }[]
    kinds: { kind: PackKind; n: number }[]
    sources: { source: SourceKind; n: number }[]
  }>(sql`
    select
      (select coalesce(json_agg(json_build_object('dimension', s.dimension, 'slug', s.slug, 'name', s.name, 'n', s.n)
                                order by s.dimension, s.n desc, s.name), '[]'::json)
         from (select t.dimension, t.slug, t.name, count(distinct p.id)::int as n
                 from tags t join pack_tags pt on pt.tag_id = t.id join packs p on p.id = pt.pack_id and p.status = 'published'
                 group by t.id, t.dimension, t.slug, t.name) s) as tags,
      (select coalesce(json_agg(json_build_object('kind', s.kind, 'n', s.n) order by s.n desc, s.kind), '[]'::json)
         from (select kind, count(*)::int as n from packs where status = 'published' group by kind) s) as kinds,
      (select coalesce(json_agg(json_build_object('source', s.source_kind, 'n', s.n) order by s.n desc, s.source_kind), '[]'::json)
         from (select source_kind, count(*)::int as n from packs where status = 'published' group by source_kind) s) as sources`)
  const tags = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as CountedRef[]])) as Record<TagDimension, CountedRef[]>
  for (const t of r?.tags ?? []) tags[t.dimension]?.push({ slug: t.slug, name: t.name, packCount: num(t.n) })
  return {
    tags,
    kinds: (r?.kinds ?? []).map((k) => ({ kind: k.kind, packCount: num(k.n) })),
    sources: (r?.sources ?? []).map((s) => ({ sourceKind: s.source, packCount: num(s.n) })),
  }
}

/** Facet lists for 探索 and the /packs filter panels (cached 30 s). */
export function getFacets(): Promise<Facets> {
  return cached('facets', LIST_TTL_MS, async () => {
    const [tagFacets, chars, artists] = await Promise.all([loadFacetTags(), characterEntries(), artistEntries()])
    return {
      characters: chars.filter((c) => c.card.packCount > 0).map((c) => ({ slug: c.card.slug, name: c.card.name, packCount: c.card.packCount })),
      artists: artists.map((a) => ({ slug: a.card.slug, name: a.card.name, packCount: a.card.packCount })),
      ...tagFacets,
    }
  })
}

/** A uniformly random point in the emoji id space (ids are r- + 20 random hex digits). */
function randomEmojiProbe(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return 'r-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function getExplore(now = new Date()): Promise<ExploreData> {
  const day = shanghaiDay(now)
  const packKey = seededHash(sql.raw('p.id::text'), day)
  const emojiKey = seededHash(sql.raw('e.id'), day)
  const probe = randomEmojiProbe()
  const visible = sql.raw(`e.status = 'published' and p.status = 'published'`)
  const cardSource = sql`
    (select p.id, 'random' as bucket, 1::bigint as ord from packs p where p.status = 'published' order by random() limit 1)
    union all
    (select p.id, 'today', row_number() over (order by ${packKey}, p.id)
       from packs p where p.status = 'published'
       order by ${packKey}, p.id limit ${TODAY_PACKS})`
  const [cardRows, tileRows, facets] = await Promise.all([
    rows<CardRow & { bucket: string }>(sql`${cardSelect(cardSource)} order by src.bucket, src.ord`),
    // random emoji: the first visible id at or after a random probe (wrapping around), an index
    // range scan instead of sorting the whole table by random()
    rows<TileRow & { bucket: string }>(sql`
      (select ${TILE_COLUMNS}, 'random' as bucket, 1::bigint as ord
         from emojis e join packs p on p.id = e.pack_id
         where ${visible} and e.id >= ${probe} order by e.id limit 1)
      union all
      (select ${TILE_COLUMNS}, 'random', 2
         from emojis e join packs p on p.id = e.pack_id
         where ${visible} order by e.id limit 1)
      union all
      (select ${TILE_COLUMNS}, 'today', row_number() over (order by ${emojiKey}, e.id)
         from emojis e join packs p on p.id = e.pack_id
         where ${visible}
         order by ${emojiKey}, e.id limit ${TODAY_EMOJIS})
      order by bucket, ord`),
    getFacets(),
  ])

  let randomPack: PackCard | null = null
  const todayPacks: PackCard[] = []
  for (const r of cardRows) {
    if (r.bucket === 'random') randomPack = toPackCard(r)
    else todayPacks.push(toPackCard(r))
  }
  let randomEmoji: EmojiTile | null = null
  const todayEmojis: EmojiTile[] = []
  for (const r of tileRows) {
    if (r.bucket === 'random') randomEmoji ??= toEmojiTile(r)
    else todayEmojis.push(toEmojiTile(r))
  }
  return { randomPack, randomEmoji, today: { day, packs: todayPacks, emojis: todayEmojis }, facets }
}
