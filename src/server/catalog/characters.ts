import { sql } from 'drizzle-orm'
import { cached, LIST_TTL_MS } from './cache'
import { type RawImage, toEmojiImageOrNull } from './images'
import { characterDetailInput, type CharacterDetailInput, charactersInput, type CharactersInput } from './inputs'
import { resolveLegacyPath } from './legacy'
import { packPage } from './packs'
import { emojiPage } from './stream'
import { emojiJson, emojiOrder, isoOrNull, num, rows } from './sql'
import type { CharacterArtist, CharacterCard, CharacterLookup } from './types'

// 角色图鉴 and 角色详情. Counts are computed live over published rows (the denormalized
// characters.pack_count / emoji_count columns are not trusted), and the whole list is cached 30 s.
//   packCount  = published packs linked through pack_characters
//   emojiCount = published emojis (in published packs) linked through emoji_characters
// Only characters with published content are listed.

interface CharacterRow {
  id: number
  slug: string
  name: string
  color: string | null
  sort: number
  pack_count: number
  emoji_count: number
  latest: Date | null
  avatar: RawImage | null
}

export interface CharacterEntry {
  id: number
  sort: number
  card: CharacterCard
}

/**
 * Avatar: characters.avatar_emoji_id when it is published (in a published pack); otherwise an emoji
 * tagged with the character, else any emoji of its packs — from the most downloaded pack, in pack order.
 */
async function loadCharacters(): Promise<CharacterEntry[]> {
  // set-based (one pass over emoji_characters for counts and tagged avatars); the per-character
  // pack fallback only runs for characters without a tagged emoji
  const list = await rows<CharacterRow>(sql`
    with pc as (
      select x.character_id as cid, count(*)::int as n, max(coalesce(p.published_at, p.created_at)) as latest
      from pack_characters x join packs p on p.id = x.pack_id
      where p.status = 'published'
      group by x.character_id
    ),
    tagged as (
      select x.character_id as cid, e.id, p.download_count, p.id as pack_id, e.sort_order, e.created_at
      from emoji_characters x join emojis e on e.id = x.emoji_id join packs p on p.id = e.pack_id
      where e.status = 'published' and p.status = 'published'
    ),
    ec as (select cid, count(*)::int as n from tagged group by cid),
    best as (
      select distinct on (cid) cid, id from tagged
      order by cid, download_count desc, pack_id, sort_order, created_at, id
    )
    select c.id, c.slug, c.name, c.theme_color as color, c.sort,
      coalesce(pc.n, 0) as pack_count, coalesce(ec.n, 0) as emoji_count, pc.latest,
      (case when av.id is null then null else ${emojiJson('av')} end) as avatar
    from characters c
    left join pc on pc.cid = c.id
    left join ec on ec.cid = c.id
    left join best on best.cid = c.id
    left join lateral (
      select e.id from emojis e join packs p on p.id = e.pack_id
      where e.id = c.avatar_emoji_id and e.status = 'published' and p.status = 'published'
    ) own on true
    left join lateral (
      select e.id from pack_characters x join packs p on p.id = x.pack_id join emojis e on e.pack_id = p.id
      where best.id is null and own.id is null
        and x.character_id = c.id and p.status = 'published' and e.status = 'published'
      order by p.download_count desc, p.id, ${emojiOrder('e')}
      limit 1
    ) fallback on true
    left join emojis av on av.id = coalesce(own.id, best.id, fallback.id)
    where pc.n > 0 or ec.n > 0
    order by coalesce(ec.n, 0) desc, coalesce(pc.n, 0) desc, c.sort, c.id`)
  return list.map((r) => ({
    id: num(r.id),
    sort: num(r.sort),
    card: {
      slug: r.slug,
      name: r.name,
      color: r.color ?? null,
      avatar: toEmojiImageOrNull(r.avatar),
      packCount: num(r.pack_count),
      emojiCount: num(r.emoji_count),
      latestAt: isoOrNull(r.latest),
    },
  }))
}

/** All listed characters, most emojis first (cached). */
export function characterEntries(): Promise<CharacterEntry[]> {
  return cached('characters', LIST_TTL_MS, loadCharacters)
}

/** 角色图鉴: count = most emojis first, recent = newest pack first, pinyin = by slug. */
export async function listCharacters(input: CharactersInput = { sort: 'count' }): Promise<CharacterCard[]> {
  const { sort } = charactersInput.parse(input)
  const cards = (await characterEntries()).map((e) => e.card)
  if (sort === 'recent') return [...cards].sort((a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? '') || a.slug.localeCompare(b.slug))
  if (sort === 'pinyin') return [...cards].sort((a, b) => a.slug.localeCompare(b.slug))
  return cards
}

export async function getCharacterDetail(input: CharacterDetailInput): Promise<CharacterLookup> {
  const i = characterDetailInput.parse(input)
  const entry = (await characterEntries()).find((e) => e.card.slug === i.slug)
  if (!entry) {
    const hop = await resolveLegacyPath(`/characters/${i.slug}`)
    return hop ? { kind: 'redirect', redirectTo: hop.location } : { kind: 'missing' }
  }

  const extras = rows<{ aliases: string[]; artists: { slug: string; name: string; n: number }[] }>(sql`
    select
      (select coalesce(array_agg(ca.alias order by ca.alias), '{}') from character_aliases ca where ca.character_id = ${entry.id}) as aliases,
      (select coalesce(json_agg(json_build_object('slug', s.slug, 'name', s.name, 'n', s.n) order by s.n desc, s.name), '[]'::json)
         from (
           select a.slug, a.name, count(distinct p.id)::int as n
           from pack_characters pc
           join packs p on p.id = pc.pack_id and p.status = 'published'
           join pack_artists pa on pa.pack_id = p.id and pa.role = 'artist'
           join artists a on a.id = pa.artist_id
           where pc.character_id = ${entry.id}
           group by a.id, a.slug, a.name
           order by n desc, a.name
           limit 48
         ) s) as artists`)

  const base = async () => {
    const [x] = await extras
    const artists: CharacterArtist[] = (x?.artists ?? []).map((a) => ({ slug: a.slug, name: a.name, packCount: num(a.n) }))
    return { character: { ...entry.card, aliases: x?.aliases ?? [] }, artists }
  }

  if (i.tab === 'emojis') {
    const [b, page] = await Promise.all([
      base(),
      emojiPage({ character: i.slug, type: i.type }, { sort: i.emojiSort, seed: i.seed, cursor: i.cursor, limit: i.limit }),
    ])
    return { kind: 'character', ...b, tab: 'emojis', page }
  }
  const [b, page] = await Promise.all([
    base(),
    packPage({ character: i.slug }, { sort: i.sort, seed: i.seed, cursor: i.cursor, limit: Math.min(i.limit, 60) }),
  ])
  return { kind: 'character', ...b, tab: 'packs', page }
}
