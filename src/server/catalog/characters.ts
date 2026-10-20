import { sql } from 'drizzle-orm'
import { parsePortraitKey, PORTRAIT_WIDTHS, portraitUrl } from '../media/keys'
import { appearsInPackIds, attributionTable } from './attribution'
import { cached, LIST_TTL_MS } from './cache'
import { type RawImage, toEmojiImage } from './images'
import { characterDetailInput, type CharacterDetailInput, charactersInput, type CharactersInput } from './inputs'
import { resolveLegacyPath } from './legacy'
import { packPage } from './packs'
import { emojiPage } from './stream'
import { emojiJson, emojiVisible, isoOrNull, num, packPublished, packVisible, PUB_AT, rows } from './sql'
import type { CharacterArtist, CharacterCard, CharacterLookup, CharacterPortrait } from './types'

// 角色图鉴 and 角色详情. Which stickers belong to a character is decided in attribution.ts; here:
//   emojiCount (张)  = public stickers attributed to the character
//   packCount (包)   = public packs holding at least one of them
//   groupCount (合集) = public packs it appears on (pack-level or sticker tags) that are not its 包
// Listed: every character with a 包 or 合集包, or an official portrait (the atlas matches the official
// one; 忌炎 and 丹瑾 are there even when they only appear in group packs). Order: 张, then 合集, then
// pinyin. Counts are computed live (the denormalized characters.pack_count / emoji_count columns are
// not trusted); the whole list is cached 30 s.
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
  group_count: number
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
    presence as (
      select x.character_id as cid, p.id as pack_id, ${PUB_AT} as pub_at
      from pack_characters x join packs p on p.id = x.pack_id where ${packVisible('p')}
      union
      select x.character_id, p.id, ${PUB_AT}
      from emoji_characters x join emojis e on e.id = x.emoji_id join packs p on p.id = e.pack_id
      where ${emojiVisible('e')} and ${packPublished('p')}
    ),
    ownp as (select distinct cid, pack_id from pub),
    groups as (
      select pr.cid, count(*)::int as n, max(pr.pub_at) as latest
      from presence pr left join ownp o on o.cid = pr.cid and o.pack_id = pr.pack_id
      where o.cid is null
      group by pr.cid
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
      coalesce(n.packs, 0) as pack_count, coalesce(n.n, 0) as emoji_count, coalesce(g.n, 0) as group_count,
      greatest(n.latest, g.latest) as latest,
      (select json_build_object('img', ${emojiJson('e')}, 'key', ${imageKey})
         from emojis e join packs p on p.id = e.pack_id
         where e.id = c.avatar_emoji_id and ${emojiVisible('e')} and ${packPublished('p')}) as own,
      cj.list as candidates
    from characters c
      left join counts n on n.cid = c.id
      left join groups g on g.cid = c.id
      left join candj cj on cj.cid = c.id
    where n.cid is not null or g.cid is not null or c.portrait_key is not null
    order by coalesce(n.n, 0) desc, coalesce(g.n, 0) desc, c.slug, c.id`)
  // a portrait_key that is not a valid key does not list a character on its own
  const listed = list.filter((r) => num(r.emoji_count) > 0 || num(r.group_count) > 0 || toPortrait(r.portrait_key))
  const avatars = assignAvatars(listed.map((r) => ({ ...r, id: num(r.id) })))
  return listed.map((r) => {
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
        groupCount: num(r.group_count),
        latestAt: isoOrNull(r.latest),
      },
    }
  })
}

/** All listed characters: most stickers first, then most 合集包, then pinyin (cached). */
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

export async function getCharacterDetail(input: CharacterDetailInput): Promise<CharacterLookup> {
  const i = characterDetailInput.parse(input)
  const entry = (await characterEntries()).find((e) => e.card.slug === i.slug)
  if (!entry) {
    const hop = await resolveLegacyPath(`/characters/${i.slug}`)
    return hop ? { kind: 'redirect', redirectTo: hop.location } : { kind: 'missing' }
  }

  // artists of the packs it appears on (包 and 合集包)
  const extras = rows<{ aliases: string[]; artists: { slug: string; name: string; n: number }[] }>(sql`
    select
      (select coalesce(array_agg(ca.alias order by ca.alias), '{}') from character_aliases ca where ca.character_id = ${entry.id}) as aliases,
      (select coalesce(json_agg(json_build_object('slug', s.slug, 'name', s.name, 'n', s.n) order by s.n desc, s.name), '[]'::json)
         from (
           select a.slug, a.name, count(distinct p.id)::int as n
           from packs p
           join pack_artists pa on pa.pack_id = p.id and pa.role = 'artist'
           join artists a on a.id = pa.artist_id
           where ${packVisible('p')} and p.id in (${appearsInPackIds(entry.card.slug)})
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
  // a character without 包 opens on its 合集包
  const groups = i.tab === 'groups' || (entry.card.packCount === 0 && entry.card.groupCount > 0)
  const filter = groups ? { groupOf: i.slug } : { character: i.slug }
  const [b, page] = await Promise.all([base(), packPage(filter, { sort: i.sort, seed: i.seed, cursor: i.cursor, limit: Math.min(i.limit, 60) })])
  return { kind: 'character', ...b, tab: groups ? 'groups' : 'packs', page }
}
