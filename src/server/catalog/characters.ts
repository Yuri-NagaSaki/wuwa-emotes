import { sql } from 'drizzle-orm'
import { parsePortraitKey, PORTRAIT_WIDTHS, portraitUrl } from '../media/keys'
import { attributedEmojiIds, attributionTable } from './attribution'
import { cached, LIST_TTL_MS } from './cache'
import { type RawImage, toEmojiImage } from './images'
import { characterDetailInput, type CharacterDetailInput, charactersInput, type CharactersInput } from './inputs'
import { resolveLegacyPath } from './legacy'
import { packPage } from './packs'
import { emojiPage } from './stream'
import { characterVisible, emojiJson, emojiVisible, isoOrNull, num, packPublished, packVisible, PUB_AT, rows } from './sql'
import type { CharacterArtist, CharacterCard, CharacterLookup, CharacterPortrait } from './types'

// 角色图鉴 and 角色详情. Which stickers belong to a character is decided in attribution.ts; here:
//   emojiCount (张) = public stickers attributed to the character
//   packCount (包)  = public packs holding at least one of them
// Only characters with 张 > 0 are listed. Counts are computed live (the denormalized
// characters.pack_count / emoji_count columns are not trusted); the whole list is cached 30 s.
//
// Avatars: no two characters ever show the same sticker (compared by image: sha256, else format and
// byte size, else id). characters.avatar_emoji_id wins when it is public and no character earlier in
// the list claimed it; otherwise the first free sticker attributed to that character alone, from its
// most downloaded pack in pack order. Nothing free: null (the UI draws a placeholder).

/** Candidate avatars fetched per character; collisions only come from overrides and duplicates. */
const AVATAR_CANDIDATES = 12

interface AvatarChoice {
  img: RawImage
  /** image identity for the uniqueness rule */
  key: string
}

interface CharacterRow {
  id: number
  slug: string
  name: string
  color: string | null
  sort: number
  portrait_key: string | null
  pack_count: number
  emoji_count: number
  latest: Date | null
  own: AvatarChoice | null
  candidates: AvatarChoice[] | null
}

export interface CharacterEntry {
  id: number
  sort: number
  card: CharacterCard
}

/** Image identity of emoji alias `e`: v1 imports carry no sha256, so fall back to format + bytes. */
function imageKeyText(e: string): string {
  return `coalesce(${e}.sha256, case when ${e}.bytes > 0 then ${e}.format || ':' || ${e}.bytes::text end, ${e}.id)`
}

/** characters.portrait_key → the DTO; a malformed key is treated as no portrait. */
export function toPortrait(key: string | null): CharacterPortrait | null {
  const ref = key ? parsePortraitKey(key) : null
  if (!ref) return null
  const widths = PORTRAIT_WIDTHS.filter((w) => w <= ref.width)
  const url = (width: (typeof widths)[number]) => portraitUrl({ ...ref, width })
  return {
    src: url(widths[0]!),
    srcSet: widths.map((w) => `${url(w)} ${w}w`).join(', '),
    width: ref.width,
    height: Math.round((ref.width * 4) / 3),
  }
}

/** Unique avatars: admin overrides first (in list order), then each character's first free candidate. */
export function assignAvatars<T extends { id: number; own: AvatarChoice | null; candidates: AvatarChoice[] | null }>(list: T[]): Map<number, RawImage | null> {
  const taken = new Set<string>()
  const out = new Map<number, RawImage | null>()
  for (const r of list) {
    if (r.own && !taken.has(r.own.key)) {
      taken.add(r.own.key)
      out.set(r.id, r.own.img)
    }
  }
  for (const r of list) {
    if (out.has(r.id)) continue
    const pick = (r.candidates ?? []).find((c) => !taken.has(c.key))
    if (pick) taken.add(pick.key)
    out.set(r.id, pick?.img ?? null)
  }
  return out
}

async function loadCharacters(): Promise<CharacterEntry[]> {
  const imageKey = sql.raw(imageKeyText('e'))
  const list = await rows<CharacterRow>(sql`
    with att as (${attributionTable()}),
    pub as (
      select a.character_id as cid, e.id, p.id as pack_id, p.download_count, e.sort_order, e.created_at, ${PUB_AT} as pub_at,
        a.shared, ${imageKey} as image_key
      from att a join emojis e on e.id = a.emoji_id join packs p on p.id = e.pack_id
      where ${emojiVisible('e')} and ${packPublished('p')}
    ),
    counts as (
      select cid, count(*)::int as n, count(distinct pack_id)::int as packs, max(pub_at) as latest from pub group by cid
    ),
    cand as (
      select cid, id, image_key,
        row_number() over (partition by cid order by download_count desc, pack_id, sort_order, created_at, id) as rn
      from pub where shared = 1
    ),
    candj as (
      select k.cid, json_agg(json_build_object('img', ${emojiJson('e')}, 'key', k.image_key) order by k.rn) as list
      from cand k join emojis e on e.id = k.id
      where k.rn <= ${AVATAR_CANDIDATES}
      group by k.cid
    )
    select c.id, c.slug, c.name, c.theme_color as color, c.sort, c.portrait_key,
      n.packs as pack_count, n.n as emoji_count, n.latest,
      (select json_build_object('img', ${emojiJson('e')}, 'key', ${imageKey})
         from emojis e join packs p on p.id = e.pack_id
         where e.id = c.avatar_emoji_id and ${emojiVisible('e')} and ${packPublished('p')}) as own,
      cj.list as candidates
    from characters c join counts n on n.cid = c.id left join candj cj on cj.cid = c.id
    order by n.n desc, n.packs desc, c.sort, c.id`)
  const avatars = assignAvatars(list.map((r) => ({ ...r, id: num(r.id) })))
  return list.map((r) => {
    const avatar = avatars.get(num(r.id)) ?? null
    return {
      id: num(r.id),
      sort: num(r.sort),
      card: {
        slug: r.slug,
        name: r.name,
        color: r.color?.trim() || null,
        avatar: avatar ? toEmojiImage(avatar) : null,
        portrait: toPortrait(r.portrait_key),
        packCount: num(r.pack_count),
        emojiCount: num(r.emoji_count),
        latestAt: isoOrNull(r.latest),
      },
    }
  })
}

/** All listed characters, most attributed stickers first (cached). */
export function characterEntries(): Promise<CharacterEntry[]> {
  return cached('characters', LIST_TTL_MS, loadCharacters)
}

/** 角色图鉴: count = most stickers first, recent = newest pack first, pinyin = by slug. */
export async function listCharacters(input: CharactersInput = { sort: 'count' }): Promise<CharacterCard[]> {
  const { sort } = charactersInput.parse(input)
  const cards = (await characterEntries()).map((e) => e.card)
  if (sort === 'recent') return [...cards].sort((a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? '') || a.slug.localeCompare(b.slug))
  if (sort === 'pinyin') return [...cards].sort((a, b) => a.slug.localeCompare(b.slug))
  return cards
}

/**
 * A character that is not listed but appears on a public pack or sticker (a group pack without
 * per-sticker tags): its name, so links to its page can go to a search instead of a 404.
 */
async function unlistedName(slug: string): Promise<string | null> {
  const [r] = await rows<{ name: string }>(sql`select c.name from characters c where c.slug = ${slug} and ${characterVisible('c')}`)
  return r?.name ?? null
}

export async function getCharacterDetail(input: CharacterDetailInput): Promise<CharacterLookup> {
  const i = characterDetailInput.parse(input)
  const entry = (await characterEntries()).find((e) => e.card.slug === i.slug)
  if (!entry) {
    const hop = await resolveLegacyPath(`/characters/${i.slug}`)
    if (hop) return { kind: 'redirect', redirectTo: hop.location }
    const name = await unlistedName(i.slug)
    return name ? { kind: 'redirect', redirectTo: `/search?q=${encodeURIComponent(name)}`, temporary: true } : { kind: 'missing' }
  }

  // artists of the packs that count as the character's 包
  const extras = rows<{ aliases: string[]; artists: { slug: string; name: string; n: number }[] }>(sql`
    select
      (select coalesce(array_agg(ca.alias order by ca.alias), '{}') from character_aliases ca where ca.character_id = ${entry.id}) as aliases,
      (select coalesce(json_agg(json_build_object('slug', s.slug, 'name', s.name, 'n', s.n) order by s.n desc, s.name), '[]'::json)
         from (
           select a.slug, a.name, count(distinct p.id)::int as n
           from packs p
           join pack_artists pa on pa.pack_id = p.id and pa.role = 'artist'
           join artists a on a.id = pa.artist_id
           where ${packVisible('p')}
             and p.id in (select e.pack_id from emojis e where e.id in (${attributedEmojiIds(entry.card.slug)}) and ${emojiVisible('e')})
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
