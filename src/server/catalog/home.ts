import { sql } from 'drizzle-orm'
import { cached, LIST_TTL_MS } from './cache'
import { type CardRow, cardSelect, toPackCard } from './cards'
import { characterEntries } from './characters'
import { num, PUB_AT, rows } from './sql'
import type { CatalogStats, CollectionRef, HomeData, PackCard } from './types'

// 首页 in two statements (cards for latest/pinned/featured, stats + featured collection) plus the cached
// character list; the assembled result is cached 30 s.
//
// 「今日新增」: published emojis (in published packs) whose time of going public falls on today's
// Asia/Shanghai date. Emojis carry no published_at, so that time is approximated as
// greatest(emoji created_at, pack published_at): new packs count all their emojis on the day they are
// published, emojis added to an existing pack count on the day they were ingested.

export const HOME_LATEST = 12
export const HOME_PINNED = 8
export const HOME_FEATURED = 8
export const HOME_CHARACTERS = 16

const SHANGHAI_TODAY = sql.raw(`(date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`)

/** First published collection (by sort) that has at least one published pack. */
const FEATURED_COLLECTION = sql.raw(
  `select co.id, co.slug, co.title, co.description from collections co ` +
    `where co.published and exists (select 1 from collection_packs x join packs q on q.id = x.pack_id ` +
    `where x.collection_id = co.id and q.status = 'published') order by co.sort, co.id limit 1`,
)

async function loadHome(): Promise<HomeData> {
  const source = sql`
    with fc as (${FEATURED_COLLECTION})
    (select p.id, 'latest' as bucket, row_number() over (order by ${PUB_AT} desc, p.id desc) as ord
       from packs p where p.status = 'published'
       order by ${PUB_AT} desc, p.id desc limit ${HOME_LATEST})
    union all
    (select p.id, 'pinned', row_number() over (order by p.pin_level desc, ${PUB_AT} desc, p.id desc)
       from packs p where p.status = 'published' and p.pin_level > 0
       order by p.pin_level desc, ${PUB_AT} desc, p.id desc limit ${HOME_PINNED})
    union all
    (select cp.pack_id, 'featured', row_number() over (order by cp.sort, cp.pack_id)
       from collection_packs cp join packs p on p.id = cp.pack_id and p.status = 'published'
       where cp.collection_id = (select fc.id from fc)
       order by cp.sort, cp.pack_id limit ${HOME_FEATURED})`

  const [cardRows, statRows, chars] = await Promise.all([
    rows<CardRow & { bucket: string; ord: number }>(sql`${cardSelect(source)} order by src.bucket, src.ord`),
    rows<{ packs: number; emojis: number; today: number; downloads: number; collection: CollectionRef | null }>(sql`
      select
        (select count(*)::int from packs where status = 'published') as packs,
        (select count(*)::int from emojis e join packs p on p.id = e.pack_id
          where e.status = 'published' and p.status = 'published') as emojis,
        (select count(*)::int from emojis e join packs p on p.id = e.pack_id
          where e.status = 'published' and p.status = 'published'
            and greatest(e.created_at, ${PUB_AT}) >= ${SHANGHAI_TODAY}) as today,
        (select coalesce(sum(download_count), 0)::float8 from packs where status = 'published') as downloads,
        (select json_build_object('slug', fc.slug, 'title', fc.title, 'description', fc.description)
           from (${FEATURED_COLLECTION}) fc) as collection`),
    characterEntries(),
  ])

  const buckets: Record<string, PackCard[]> = { latest: [], pinned: [], featured: [] }
  for (const r of cardRows) buckets[r.bucket]?.push(toPackCard(r))
  const s = statRows[0]
  const stats: CatalogStats = {
    packs: num(s?.packs),
    emojis: num(s?.emojis),
    characters: chars.length,
    todayEmojis: num(s?.today),
    downloads: num(s?.downloads),
  }
  const c = s?.collection
  return {
    latest: buckets.latest!,
    pinned: buckets.pinned!,
    featuredCollection: c ? { slug: c.slug, title: c.title, description: c.description ?? null } : null,
    featured: buckets.featured!,
    characters: chars
      .map((e) => e.card)
      .filter((card) => card.avatar)
      .slice(0, HOME_CHARACTERS),
    stats,
  }
}

export function getHome(): Promise<HomeData> {
  return cached('home', LIST_TTL_MS, loadHome)
}
