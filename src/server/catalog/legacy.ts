import { type SQL, sql } from 'drizzle-orm'
import { EMOJI_ID_RE } from '#/shared/ids'
import { artistVisible, characterVisible, emojiVisible, packPublished, packVisible, rows, tagVisible } from './sql'
import type { LegacyRedirect } from './types'

// Old-site paths → new paths, for the platform's 301 handler (and renamed pack/character slugs).
//   1. The redirects table (exact path, chains followed up to MAX_HOPS; loops resolve to nothing).
//      The target must be public: a redirect to a draft pack or an unknown character is ignored.
//   2. Otherwise built-in fallbacks:
//        /archives/:postName    → /packs/:slug   (packs.legacy_post_name, pack_key or slug)
//        /tags/:slug            → /characters/:slug (legacy_slug or slug, "character-" prefix tolerated),
//                                 then /artists/:slug, then tag lists (/packs?group= or /packs?tag=dim:slug)
//        /characters/:oldSlug   → characters.legacy_slug
//        /artists/:oldSlug      → artists.legacy_slug
//        /packs/:oldSlug        → pack_key (the slug at first ingest) of a renamed pack
// At most two SQL statements per call.

const MAX_HOPS = 5
const CODES = new Set([301, 302, 307, 308])

/** Candidate lookup keys for a request path: decoded first, then as sent. Null if unusable. */
export function normalizeLegacyPath(input: string): string[] | null {
  let path = input.trim()
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname
    } catch {
      return null
    }
  }
  path = path.split(/[?#]/)[0] ?? ''
  if (!path.startsWith('/')) path = '/' + path
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (path.length > 512) return null
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // keep the raw form only
  }
  return decoded === path ? [path] : [decoded, path]
}

/** Same-site absolute path only (no scheme, no protocol-relative //host). */
function isLocalPath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\')
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** One statement checking that a redirect target is publicly visible; other site paths pass. */
async function targetIsPublic(location: string): Promise<boolean> {
  const path = location.split(/[?#]/)[0] ?? ''
  const seg = segments(path).map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  if (seg.length !== 2) return true
  const [kind, slug] = seg as [string, string]
  let check: SQL | null = null
  if (kind === 'packs') check = sql`select 1 from packs p where p.slug = ${slug} and ${packVisible('p')}`
  if (kind === 'characters') check = sql`select 1 from characters c where c.slug = ${slug} and ${characterVisible('c')}`
  if (kind === 'artists') check = sql`select 1 from artists a where a.slug = ${slug} and ${artistVisible('a')}`
  if (kind === 'e') {
    if (!EMOJI_ID_RE.test(slug)) return false
    check = sql`select 1 from emojis e join packs p on p.id = e.pack_id
                where e.id = ${slug} and ${emojiVisible('e')} and ${packPublished('p')}`
  }
  if (!check) return true
  return (await rows(check)).length > 0
}

const enc = encodeURIComponent

async function fallback(path: string): Promise<string | null> {
  const seg = segments(path)
  if (seg.length !== 2) return null
  const [kind, x] = seg as [string, string]
  if (x.length > 200) return null

  if (kind === 'archives') {
    const r = await rows<{ slug: string }>(sql`
      select p.slug from packs p
      where ${packVisible('p')} and (p.legacy_post_name = ${x} or p.pack_key = ${x} or p.slug = ${x})
      order by (p.legacy_post_name = ${x}) is true desc, (p.slug = ${x}) desc, p.id
      limit 1`)
    return r[0] ? `/packs/${enc(r[0].slug)}` : null
  }

  if (kind === 'packs') {
    const r = await rows<{ slug: string }>(sql`
      select p.slug from packs p where ${packVisible('p')} and p.pack_key = ${x} and p.slug <> ${x} limit 1`)
    return r[0] ? `/packs/${enc(r[0].slug)}` : null
  }

  if (kind === 'characters') {
    const r = await rows<{ slug: string }>(sql`
      select c.slug from characters c
      where c.legacy_slug = ${x} and c.slug <> ${x} and ${characterVisible('c')} limit 1`)
    return r[0] ? `/characters/${enc(r[0].slug)}` : null
  }

  if (kind === 'artists') {
    const r = await rows<{ slug: string }>(sql`
      select a.slug from artists a where a.legacy_slug = ${x} and a.slug <> ${x} and ${artistVisible('a')} limit 1`)
    return r[0] ? `/artists/${enc(r[0].slug)}` : null
  }

  if (kind === 'tags') {
    const bare = x.startsWith('character-') ? x.slice('character-'.length) : x
    const r = await rows<{ to: string; slug: string; dimension: string | null }>(sql`
      select * from (
        (select 'character' as to, c.slug, null::text as dimension, 0 as pri, (c.legacy_slug = ${x}) is true as exact
           from characters c
           where (c.legacy_slug in (${x}, ${bare}) or c.slug in (${x}, ${bare})) and ${characterVisible('c')})
        union all
        (select 'artist', a.slug, null, 1, (a.legacy_slug = ${x}) is true
           from artists a where (a.legacy_slug = ${x} or a.slug = ${x}) and ${artistVisible('a')})
        union all
        (select 'tag', t.slug, t.dimension, 2, t.dimension = 'group'
           from tags t where t.slug = ${x} and ${tagVisible('t')})
      ) m
      order by pri, exact desc, slug
      limit 1`)
    const m = r[0]
    if (!m) return null
    if (m.to === 'character') return `/characters/${enc(m.slug)}`
    if (m.to === 'artist') return `/artists/${enc(m.slug)}`
    return m.dimension === 'group' ? `/packs?group=${enc(m.slug)}` : `/packs?tag=${enc(`${m.dimension}:${m.slug}`)}`
  }
  return null
}

export async function resolveLegacyPath(input: string): Promise<LegacyRedirect | null> {
  const cands = normalizeLegacyPath(input)
  if (!cands) return null
  const chain = await rows<{ to_path: string; code: number; dangling: boolean }>(sql`
    with recursive chain(to_path, code, depth) as (
      (select r.to_path, r.code, 1 from redirects r
        where r.from_path = any(${sql.param(cands)}::text[])
        order by array_position(${sql.param(cands)}::text[], r.from_path) limit 1)
      union all
      select r.to_path, chain.code, chain.depth + 1
      from redirects r join chain on r.from_path = chain.to_path
      where chain.depth < ${MAX_HOPS}
    )
    select chain.to_path, chain.code,
      exists (select 1 from redirects r2 where r2.from_path = chain.to_path) as dangling
    from chain order by depth desc limit 1`)

  const hop = chain[0]
  let location: string | null = null
  let status: LegacyRedirect['status'] = 301
  if (hop) {
    // a chain that still points at another redirect after MAX_HOPS is a loop (or too long): ignore it
    if (hop.dangling || !isLocalPath(hop.to_path)) return null
    if (!(await targetIsPublic(hop.to_path))) return null
    location = hop.to_path
    if (CODES.has(Number(hop.code))) status = Number(hop.code) as LegacyRedirect['status']
  } else {
    location = await fallback(cands[0]!)
  }
  if (!location || cands.includes(location)) return null
  return { location, status }
}
