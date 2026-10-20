import { type SQL, sql } from 'drizzle-orm'
import { artistEntries } from './artists'
import { cached, LIST_TTL_MS } from './cache'
import { packCardsByIds, publishedEmojiCount } from './cards'
import { characterEntries } from './characters'
import { type RawImage, toEmojiImageOrNull } from './images'
import { searchInput, type SearchInput, suggestInput, type SuggestInput } from './inputs'
import { coverJson, emojiVisible, likeEscape, num, packPublished, packVisible, rows } from './sql'
import { emojiPage, TILE_COLUMNS, type TileRow, toEmojiTile } from './stream'
import type { ArtistCard, CharacterCard, EmojiTile, SearchResult, Suggestion, SuggestionType, TagDimension, TagHit } from './types'

// Search over pack titles, character names + aliases, artist names + aliases and tag names.
//
// Query → needles: the whole query (weight 1) plus, for multi-word queries, each word (weight 0.5).
// Matching (pg_trgm GIN indexes back ILIKE '%…%' and % / <% for needles of 3+ characters; shorter
// needles fall back to scans, which is fine at this catalog size):
//   - a name matches a needle when it contains it (ILIKE), or, for 3+ characters, is trigram-similar
//   - score per name: exact 100 > prefix 60 > substring 30, + 10 × similarity (3+ characters)
//   - a pack matches through its title, or through a linked character / artist / tag. For
//     single-character needles (心, 椿) the link requires an exact name or alias match, so 心 finds the
//     packs of 心 and not those of 心月狐; titles still match by substring.
//   - multi-word queries: a pack must match every word (in its title or linked names).
// Ranking: score, then popularity. One statement for all groups + one for the pack cards.

const MAX_QUERY = 64
/** 表情 group of the results page: the best-matched character's stickers, else the top packs' first ones. */
export const SEARCH_EMOJIS = 16
const EMOJI_PACKS = 4
const MAX_TERMS = 5

interface Needle {
  text: string
  lower: string
  len: number
  sub: string
  prefix: string
  weight: number
}

export interface ParsedQuery {
  q: string
  needles: Needle[]
  /** the words a multi-word query must all match; empty for single-word queries */
  terms: Needle[]
}

const chars = (s: string) => Array.from(s).length

function needle(text: string, weight: number): Needle {
  const esc = likeEscape(text)
  return { text, lower: text.toLowerCase(), len: chars(text), sub: `%${esc}%`, prefix: `${esc}%`, weight }
}

export function parseQuery(raw: string): ParsedQuery | null {
  const q = Array.from(raw.normalize('NFKC').replace(/\s+/g, ' ').trim()).slice(0, MAX_QUERY).join('').trim()
  if (!q) return null
  const words = [...new Set(q.split(' ').filter(Boolean))].slice(0, MAX_TERMS)
  const whole = needle(q, 1)
  if (words.length <= 1) return { q, needles: [whole], terms: [] }
  const terms = words.map((w) => needle(w, 0.5))
  return { q, needles: [whole, ...terms.filter((t) => t.text !== q)], terms }
}

// ---- SQL builders (col is a trusted column expression; needle values are bind parameters) ----

const or = (parts: SQL[]) => sql`(${sql.join(parts, sql` or `)})`

function nameMatch(col: SQL, n: Needle): SQL {
  const parts = [sql`${col} ilike ${n.sub}`]
  if (n.len >= 3) parts.push(sql`${col} % ${n.text}`)
  return or(parts)
}

function linkMatch(col: SQL, n: Needle): SQL {
  return n.len === 1 ? sql`lower(${col}) = lower(${n.text})` : nameMatch(col, n)
}

function nameScore(col: SQL, n: Needle): SQL {
  const sim = n.len >= 3 ? sql` + 10 * similarity(${col}, ${n.text})` : sql``
  return sql`((case when lower(${col}) = lower(${n.text}) then 100 when ${col} ilike ${n.prefix} then 60
                   when ${col} ilike ${n.sub} then 30 else 0 end)${sim}) * ${n.weight}::float8`
}

function titleMatch(col: SQL, n: Needle): SQL {
  const parts = [sql`${col} ilike ${n.sub}`]
  if (n.len >= 3) parts.push(sql`${n.text} <% ${col}`)
  return or(parts)
}

function titleScore(col: SQL, n: Needle): SQL {
  const sim = n.len >= 3 ? sql` + 10 * word_similarity(${n.text}, ${col})` : sql``
  return sql`((case when lower(${col}) = lower(${n.text}) then 100 when ${col} ilike ${n.prefix} then 60
                   when ${col} ilike ${n.sub} then 30 else 0 end)${sim}) * ${n.weight}::float8`
}

function greatest(parts: SQL[]): SQL {
  return parts.length === 1 ? parts[0]! : sql`greatest(${sql.join(parts, sql`, `)})`
}

interface HitRow {
  g: 'c' | 'a' | 't' | 'p'
  id: number
  score: number
  rn: number | null
  total: number | null
  slug: string | null
  name: string | null
  dimension: TagDimension | null
  n: number | null
}

function searchSql(pq: ParsedQuery, limit: number): SQL {
  const N = pq.needles
  const anyName = (col: string) => or(N.map((n) => nameMatch(sql.raw(col), n)))
  const v = sql.raw('nm.v')
  const linkScore = greatest(N.map((n) => sql`(case when ${linkMatch(v, n)} then ${nameScore(v, n)} else 0 end)`))
  const title = sql.raw('p.title')

  // multi-word: every word must match the title or one of the pack's linked names
  const allTerms = pq.terms.length
    ? sql`and ${sql.join(
        pq.terms.map((t) => sql`(${titleMatch(title, t)} or exists (select 1 from unnest(pn.names) as pv(v) where ${linkMatch(sql.raw('pv.v'), t)}))`),
        sql` and `,
      )}`
    : sql``
  const packNames = pq.terms.length
    ? sql`cross join lateral (select array(
          select c.name from pack_characters x join characters c on c.id = x.character_id where x.pack_id = p.id
          union all select ca.alias from pack_characters x join character_aliases ca on ca.character_id = x.character_id where x.pack_id = p.id
          union all select a.name from pack_artists x join artists a on a.id = x.artist_id where x.pack_id = p.id
          union all select aa.alias from pack_artists x join artist_aliases aa on aa.artist_id = x.artist_id where x.pack_id = p.id
          union all select t.name from pack_tags x join tags t on t.id = x.tag_id where x.pack_id = p.id
        ) as names) pn`
    : sql``

  return sql`
    with names as (
      select 'c'::text as g, c.id as eid, c.name as v from characters c where ${anyName('c.name')}
      union all select 'c', ca.character_id, ca.alias from character_aliases ca where ${anyName('ca.alias')}
      union all select 'a', a.id, a.name from artists a where ${anyName('a.name')}
      union all select 'a', aa.artist_id, aa.alias from artist_aliases aa where ${anyName('aa.alias')}
      union all select 't', t.id, t.name from tags t where ${anyName('t.name')}
    ),
    disp as (
      select nm.g, nm.eid, max(${greatest(N.map((n) => nameScore(v, n)))}) as score from names nm group by nm.g, nm.eid
    ),
    links as (
      select nm.g, nm.eid, max(${linkScore}) as ls from names nm group by nm.g, nm.eid having max(${linkScore}) > 0
    ),
    cand as (
      select p.id from packs p where ${packVisible('p')} and ${or(N.map((n) => titleMatch(title, n)))}
      union select x.pack_id from links h join pack_characters x on h.g = 'c' and x.character_id = h.eid
      union select x.pack_id from links h join pack_artists x on h.g = 'a' and x.artist_id = h.eid
      union select x.pack_id from links h join pack_tags x on h.g = 't' and x.tag_id = h.eid
    ),
    scored as (
      select p.id, p.download_count,
        ${greatest(N.map((n) => titleScore(title, n)))} + 0.5 * coalesce(l.ls, 0) as score
      from cand join packs p on p.id = cand.id and ${packVisible('p')}
      left join lateral (
        select max(h.ls) as ls from links h
        where (h.g = 'c' and exists (select 1 from pack_characters x where x.pack_id = p.id and x.character_id = h.eid))
           or (h.g = 'a' and exists (select 1 from pack_artists x where x.pack_id = p.id and x.artist_id = h.eid))
           or (h.g = 't' and exists (select 1 from pack_tags x where x.pack_id = p.id and x.tag_id = h.eid))
      ) l on true
      ${packNames}
      where true ${allTerms}
    )
    select d.g, d.eid as id, d.score::float8 as score, null::bigint as rn, null::int as total,
      t.slug, t.name, t.dimension, tc.n
    from disp d
    left join tags t on d.g = 't' and t.id = d.eid
    left join lateral (
      select count(distinct x.pack_id)::int as n from pack_tags x join packs q on q.id = x.pack_id and ${packVisible('q')}
      where d.g = 't' and x.tag_id = d.eid
    ) tc on true
    where d.g <> 't' or tc.n > 0
    union all
    select 'p', s.id, s.score, s.rn, s.total, null, null, null, null
    from (
      select id, score::float8 as score, row_number() over (order by score desc, download_count desc, id desc) as rn,
        (count(*) over ())::int as total
      from scored
    ) s
    where s.rn <= ${limit}`
}

const BEST_SCORE = 60

export async function searchCatalog(input: SearchInput): Promise<SearchResult> {
  const { q: raw, limit } = searchInput.parse(input)
  const pq = parseQuery(raw)
  const empty: SearchResult = {
    q: pq?.q ?? '',
    best: null,
    characters: [],
    artists: [],
    packs: [],
    tags: [],
    emojis: [],
    counts: { characters: 0, artists: 0, packs: 0, tags: 0 },
  }
  if (!pq) return empty

  const [hits, chars, artists] = await Promise.all([rows<HitRow>(searchSql(pq, limit)), characterEntries(), artistEntries()])
  const charById = new Map(chars.map((e) => [e.id, e]))
  const artistById = new Map(artists.map((e) => [e.id, e]))

  const charHits: { card: CharacterCard; score: number; sort: number }[] = []
  const artistHits: { card: ArtistCard; score: number }[] = []
  const tagHits: { tag: TagHit; score: number }[] = []
  const packHits: { id: number; rn: number }[] = []
  let packTotal = 0
  for (const h of hits) {
    const score = num(h.score)
    if (h.g === 'c') {
      const e = charById.get(num(h.id))
      if (e) charHits.push({ card: e.card, score, sort: e.sort })
    } else if (h.g === 'a') {
      const e = artistById.get(num(h.id))
      if (e) artistHits.push({ card: e.card, score })
    } else if (h.g === 't') {
      tagHits.push({ tag: { dimension: h.dimension!, slug: h.slug!, name: h.name!, packCount: num(h.n) }, score })
    } else {
      packHits.push({ id: num(h.id), rn: num(h.rn) })
      packTotal = num(h.total)
    }
  }
  charHits.sort((a, b) => b.score - a.score || b.card.emojiCount - a.card.emojiCount || a.sort - b.sort || a.card.slug.localeCompare(b.card.slug))
  artistHits.sort((a, b) => b.score - a.score || b.card.packCount - a.card.packCount || a.card.slug.localeCompare(b.card.slug))
  tagHits.sort((a, b) => b.score - a.score || b.tag.packCount - a.tag.packCount || a.tag.slug.localeCompare(b.tag.slug))
  packHits.sort((a, b) => a.rn - b.rn)

  const packs = await packCardsByIds(packHits.map((p) => p.id))

  const topChar = charHits[0]
  const topArtist = artistHits[0]
  let best: SearchResult['best'] = null
  if (topChar && topChar.score >= BEST_SCORE && (!topArtist || topChar.score >= topArtist.score)) best = { type: 'character', character: topChar.card }
  else if (topArtist && topArtist.score >= BEST_SCORE) best = { type: 'artist', artist: topArtist.card }
  const emojis = await searchEmojis(best, packs.slice(0, EMOJI_PACKS).map((p) => p.id))

  return {
    q: pq.q,
    best,
    characters: charHits.slice(0, limit).map((h) => h.card),
    artists: artistHits.slice(0, limit).map((h) => h.card),
    packs,
    tags: tagHits.slice(0, limit).map((h) => h.tag),
    emojis,
    counts: { characters: charHits.length, artists: artistHits.length, packs: packTotal, tags: tagHits.length },
  }
}

/** Stickers for the 表情 group: the best-matched character's newest, or the first ones of the top packs. */
async function searchEmojis(best: SearchResult['best'], packIds: number[]): Promise<EmojiTile[]> {
  if (best?.type === 'character') return (await emojiPage({ character: best.character.slug }, { sort: 'new', limit: SEARCH_EMOJIS })).items
  if (!packIds.length) return []
  const list = await rows<TileRow>(sql`
    select ${TILE_COLUMNS}
      from emojis e join packs p on p.id = e.pack_id
      where ${emojiVisible('e')} and ${packPublished('p')} and p.id = any(${`{${packIds.join(',')}}`}::int[])
      order by array_position(${`{${packIds.join(',')}}`}::int[], p.id), e.sort_order, e.id
      limit ${SEARCH_EMOJIS}`)
  return list.map(toEmojiTile)
}

// ---- command palette: in-process index, refreshed every 30 s ----

interface IndexEntry {
  type: SuggestionType
  slug: string
  label: string
  /** lower-cased names that match like the label (aliases) */
  aliases: string[]
  /** linked names (packs only): characters, aliases, artists, tags */
  linked: string[]
  sub: string | null
  href: string
  image: string | null
  color: string | null
  popularity: number
}

const TYPE_ORDER: Record<SuggestionType, number> = { character: 0, artist: 1, pack: 2, tag: 3 }
const enc = encodeURIComponent

function tagHref(dimension: string, slug: string): string {
  return dimension === 'group' ? `/packs?group=${enc(slug)}` : `/packs?tag=${enc(`${dimension}:${slug}`)}`
}

async function loadIndex(): Promise<IndexEntry[]> {
  const [[r], chars, artists] = await Promise.all([
    rows<{
      char_aliases: { id: number; alias: string }[]
      artist_aliases: { id: number; alias: string }[]
      packs: { slug: string; title: string; downloads: number; n: number; cover: RawImage | null; names: string[] }[]
      tags: { dimension: string; slug: string; name: string; n: number }[]
    }>(sql`
      select
        (select coalesce(json_agg(json_build_object('id', ca.character_id, 'alias', ca.alias)), '[]'::json) from character_aliases ca) as char_aliases,
        (select coalesce(json_agg(json_build_object('id', aa.artist_id, 'alias', aa.alias)), '[]'::json) from artist_aliases aa) as artist_aliases,
        (select coalesce(json_agg(json_build_object(
            'slug', p.slug, 'title', p.title, 'downloads', p.download_count, 'n', ${publishedEmojiCount('p')},
            'cover', ${coverJson('p')},
            'names', array(
              select c.name from pack_characters x join characters c on c.id = x.character_id where x.pack_id = p.id
              union all select ca.alias from pack_characters x join character_aliases ca on ca.character_id = x.character_id where x.pack_id = p.id
              union all select a.name from pack_artists x join artists a on a.id = x.artist_id where x.pack_id = p.id
              union all select aa.alias from pack_artists x join artist_aliases aa on aa.artist_id = x.artist_id where x.pack_id = p.id
              union all select t.name from pack_tags x join tags t on t.id = x.tag_id where x.pack_id = p.id))), '[]'::json)
          from packs p where ${packVisible('p')}) as packs,
        (select coalesce(json_agg(json_build_object('dimension', s.dimension, 'slug', s.slug, 'name', s.name, 'n', s.n)), '[]'::json)
           from (select t.dimension, t.slug, t.name, count(distinct q.id)::int as n
                   from tags t join pack_tags x on x.tag_id = t.id join packs q on q.id = x.pack_id and ${packVisible('q')}
                   group by t.id, t.dimension, t.slug, t.name) s) as tags`),
    characterEntries(),
    artistEntries(),
  ])
  const aliasesOf = (list: { id: number; alias: string }[]) => {
    const m = new Map<number, string[]>()
    for (const a of list) m.set(num(a.id), [...(m.get(num(a.id)) ?? []), a.alias])
    return m
  }
  const charAliases = aliasesOf(r?.char_aliases ?? [])
  const artistAliases = aliasesOf(r?.artist_aliases ?? [])
  const fmt = (n: number) => n.toLocaleString('en-US')

  const out: IndexEntry[] = []
  for (const { id, card } of chars) {
    out.push({
      type: 'character',
      slug: card.slug,
      label: card.name,
      aliases: charAliases.get(id) ?? [],
      linked: [],
      sub: `${fmt(card.emojiCount)} 张 · ${card.packCount} 包`,
      href: `/characters/${enc(card.slug)}`,
      image: card.avatar?.poster ?? null,
      color: card.color,
      popularity: card.emojiCount,
    })
  }
  for (const { id, card } of artists) {
    out.push({
      type: 'artist',
      slug: card.slug,
      label: card.name,
      aliases: artistAliases.get(id) ?? [],
      linked: [],
      sub: `${card.packCount} 包`,
      href: `/artists/${enc(card.slug)}`,
      image: null,
      color: null,
      popularity: card.packCount,
    })
  }
  for (const p of r?.packs ?? []) {
    out.push({
      type: 'pack',
      slug: p.slug,
      label: p.title,
      aliases: [],
      linked: p.names ?? [],
      sub: `${num(p.n)} 张`,
      href: `/packs/${enc(p.slug)}`,
      image: toEmojiImageOrNull(p.cover)?.poster ?? null,
      color: null,
      popularity: num(p.downloads),
    })
  }
  for (const t of r?.tags ?? []) {
    out.push({
      type: 'tag',
      slug: `${t.dimension}:${t.slug}`,
      label: t.name,
      aliases: [],
      linked: [],
      sub: `${num(t.n)} 包`,
      href: tagHref(t.dimension, t.slug),
      image: null,
      color: null,
      popularity: num(t.n),
    })
  }
  return out
}

function labelScore(label: string, n: Needle): number {
  const l = label.toLowerCase()
  if (l === n.lower) return 100
  if (l.startsWith(n.lower)) return 60
  if (l.includes(n.lower)) return 30
  return 0
}

function linkedScore(name: string, n: Needle): number {
  if (n.len === 1) return name.toLowerCase() === n.lower ? 100 : 0
  return labelScore(name, n)
}

/** Quick suggestions for the command palette (in-process index; no SQL on a warm cache). */
export async function suggestCatalog(input: SuggestInput): Promise<Suggestion[]> {
  const { q: raw, limit } = suggestInput.parse(input)
  const pq = parseQuery(raw)
  if (!pq) return []
  const index = await cached('suggest-index', LIST_TTL_MS, loadIndex)
  const scored: { e: IndexEntry; score: number; via: string | null }[] = []
  for (const e of index) {
    let score = 0
    let via: string | null = null
    for (const n of pq.needles) {
      const s = labelScore(e.label, n) * n.weight
      if (s > score) {
        score = s
        via = null
      }
      for (const a of e.aliases) {
        const sa = labelScore(a, n) * n.weight
        if (sa > score) {
          score = sa
          via = a
        }
      }
      if (e.type === 'pack') for (const name of e.linked) score = Math.max(score, 0.5 * linkedScore(name, n) * n.weight)
    }
    if (score <= 0) continue
    if (pq.terms.length) {
      const all = pq.terms.every(
        (t) => labelScore(e.label, t) > 0 || e.aliases.some((a) => labelScore(a, t) > 0) || e.linked.some((name) => linkedScore(name, t) > 0),
      )
      if (!all) continue
    }
    scored.push({ e, score, via })
  }
  scored.sort(
    (a, b) => b.score - a.score || TYPE_ORDER[a.e.type] - TYPE_ORDER[b.e.type] || b.e.popularity - a.e.popularity || a.e.slug.localeCompare(b.e.slug),
  )
  return scored.slice(0, limit).map(({ e, via }) => ({
    type: e.type,
    slug: e.slug,
    label: e.label,
    sub: via ? `别名「${via}」 · ${e.sub}` : e.sub,
    href: e.href,
    image: e.image,
    color: e.color,
  }))
}
