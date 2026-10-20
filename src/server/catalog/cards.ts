import { type SQL, sql } from 'drizzle-orm'
import { type RawImage, toEmojiImage } from './images'
import { emojiJson, emojiOrder, emojiVisible, emojiVisibleText, iso, num, packVisible, PUB_AT, rows } from './sql'
import type { ArtistRef, ArtistRole, CharacterRef, PackCard, PackKind, SourceKind } from './types'

// Pack cards in one statement: the caller supplies a source subquery yielding `id` (plus any extra
// columns such as ord, bucket, k0…, score, passed through untouched as src.*); this joins the pack,
// keeps public packs only (sql.ts: published with ready emojis) and aggregates count, cover + minis,
// characters and artists. Counts and images only use public emojis.

export interface RawCharacter {
  slug: string
  name: string
  color: string | null
}

interface RawArtist {
  slug: string
  name: string
  role: ArtistRole
}

export interface CardRow {
  id: number
  slug: string
  title: string
  excerpt: string | null
  kind: PackKind
  source_kind: SourceKind
  pin_level: number
  memorial: boolean
  downloadable: boolean
  downloads: string | number
  favorites: number
  pub_at: Date | string
  n: number
  imgs: RawImage[] | null
  chars: RawCharacter[] | null
  arts: RawArtist[] | null
  [extra: string]: unknown
}

/** Characters of pack `pa` as JSON, first by characters.sort then id (the first one sets the accent). */
export function packCharactersJson(pa = 'p'): SQL {
  return sql.raw(
    `(select coalesce(json_agg(json_build_object('slug', c.slug, 'name', c.name, 'color', c.theme_color) order by c.sort, c.id), '[]'::json) ` +
      `from pack_characters pc join characters c on c.id = pc.character_id where pc.pack_id = ${pa}.id)`,
  )
}

export function packArtistsJson(pa = 'p'): SQL {
  return sql.raw(
    `(select coalesce(json_agg(json_build_object('slug', a.slug, 'name', a.name, 'role', pa.role) order by pa.role, a.name, a.id), '[]'::json) ` +
      `from pack_artists pa join artists a on a.id = pa.artist_id where pa.pack_id = ${pa}.id)`,
  )
}

/** Public emojis of pack `pa` (published, derivatives ready). */
export function publishedEmojiCount(pa = 'p'): SQL {
  return sql.raw(`(select count(*)::int from emojis ne where ne.pack_id = ${pa}.id and ${emojiVisibleText('ne')})`)
}

/**
 * `select src.*, <card columns> from (<source>) src join packs p …` — append your own ORDER BY.
 * Images: up to 4 public emojis, cover first (cover_emoji_id if it is one of them), then pack order.
 */
export function cardSelect(source: SQL): SQL {
  return sql`
    select src.*, p.slug, p.title, p.excerpt, p.kind, p.source_kind, p.pin_level, p.memorial, p.downloadable,
      p.download_count as downloads, p.favorite_count as favorites, ${PUB_AT} as pub_at,
      ${publishedEmojiCount('p')} as n,
      (select json_agg(x.j order by x.o) from (
         select ${emojiJson('e')} as j,
                row_number() over (order by (e.id = p.cover_emoji_id) is true desc, ${emojiOrder('e')}) as o
         from emojis e where e.pack_id = p.id and ${emojiVisible('e')}
         order by o limit 4
       ) x) as imgs,
      ${packCharactersJson('p')} as chars,
      ${packArtistsJson('p')} as arts
    from (${source}) src
    join packs p on p.id = src.id and ${packVisible('p')}`
}

export function toCharacterRef(c: RawCharacter): CharacterRef {
  return { slug: c.slug, name: c.name, color: c.color ?? null }
}

export function splitArtists(list: RawArtist[] | null): { artists: ArtistRef[]; commissioners: ArtistRef[] } {
  const artists: ArtistRef[] = []
  const commissioners: ArtistRef[] = []
  for (const a of list ?? []) (a.role === 'commissioner' ? commissioners : artists).push({ slug: a.slug, name: a.name })
  return { artists, commissioners }
}

export function toPackCard(r: CardRow): PackCard {
  const imgs = (r.imgs ?? []).map(toEmojiImage)
  const characters = (r.chars ?? []).map(toCharacterRef)
  return {
    id: num(r.id),
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? null,
    kind: r.kind,
    sourceKind: r.source_kind,
    pinLevel: num(r.pin_level),
    memorial: !!r.memorial,
    downloadable: !!r.downloadable,
    count: num(r.n),
    downloads: num(r.downloads),
    favorites: num(r.favorites),
    publishedAt: iso(r.pub_at),
    accent: characters[0]?.color ?? null,
    cover: imgs[0] ?? null,
    minis: imgs.slice(1, 4),
    characters,
    artists: splitArtists(r.arts).artists,
  }
}

/** Cards for an ordered list of pack ids (ids of non-public packs are dropped). */
export async function packCardsByIds(ids: number[]): Promise<PackCard[]> {
  if (ids.length === 0) return []
  // sql.param: a JS array as ONE bind parameter (a bare array would expand to "(a, b, …)")
  const source = sql`select u.id, u.ord from unnest(${sql.param(ids)}::int[]) with ordinality as u(id, ord)`
  const list = await rows<CardRow>(sql`${cardSelect(source)} order by src.ord`)
  return list.map(toPackCard)
}
