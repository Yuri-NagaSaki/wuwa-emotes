import { sql } from 'drizzle-orm'
import { cached, LIST_TTL_MS } from './cache'
import { artistDetailInput, type ArtistDetailInput } from './inputs'
import { resolveLegacyPath } from './legacy'
import { packPage } from './packs'
import { isoOrNull, num, rows } from './sql'
import type { ArtistCard, ArtistLink, ArtistLookup } from './types'

// 画师名录 and 画师主页. An artist is listed when it is linked (as artist or commissioner) to at least
// one published pack; counts are live over published rows, list cached 30 s.

interface ArtistRow {
  id: number
  slug: string
  name: string
  links: unknown
  pack_count: number
  drawn: number
  commissioned: number
  emoji_count: number
  latest: Date | null
}

export interface ArtistEntry {
  id: number
  card: ArtistCard
}

/** Admin-maintained links; only well-formed http(s) URLs leave the module. */
function safeLinks(raw: unknown): ArtistLink[] {
  if (!Array.isArray(raw)) return []
  const out: ArtistLink[] = []
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue
    const { label, url } = l as { label?: unknown; url?: unknown }
    if (typeof url !== 'string') continue
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
      out.push({ label: typeof label === 'string' && label ? label : u.hostname, url: u.toString() })
    } catch {
      // drop malformed links
    }
  }
  return out
}

async function loadArtists(): Promise<ArtistEntry[]> {
  const list = await rows<ArtistRow>(sql`
    select a.id, a.slug, a.name, a.links,
      count(distinct p.id)::int as pack_count,
      count(distinct p.id) filter (where pa.role = 'artist')::int as drawn,
      count(distinct p.id) filter (where pa.role = 'commissioner')::int as commissioned,
      (select count(*)::int from emojis e
        where e.status = 'published'
          and e.pack_id in (select x.pack_id from pack_artists x join packs q on q.id = x.pack_id
                            where x.artist_id = a.id and q.status = 'published')) as emoji_count,
      max(coalesce(p.published_at, p.created_at)) as latest
    from artists a
    join pack_artists pa on pa.artist_id = a.id
    join packs p on p.id = pa.pack_id and p.status = 'published'
    group by a.id
    order by pack_count desc, a.name, a.id`)
  return list.map((r) => ({
    id: num(r.id),
    card: {
      slug: r.slug,
      name: r.name,
      links: safeLinks(r.links),
      packCount: num(r.pack_count),
      drawnCount: num(r.drawn),
      commissionedCount: num(r.commissioned),
      emojiCount: num(r.emoji_count),
      latestAt: isoOrNull(r.latest),
    },
  }))
}

export function artistEntries(): Promise<ArtistEntry[]> {
  return cached('artists', LIST_TTL_MS, loadArtists)
}

/** 画师名录: most packs first (cached). */
export async function listArtists(): Promise<ArtistCard[]> {
  return (await artistEntries()).map((e) => e.card)
}

/** 画师主页: profile + its published packs (any role), paginated like /packs. */
export async function getArtistDetail(input: ArtistDetailInput): Promise<ArtistLookup> {
  const i = artistDetailInput.parse(input)
  const entry = (await artistEntries()).find((e) => e.card.slug === i.slug)
  if (!entry) {
    const hop = await resolveLegacyPath(`/artists/${i.slug}`)
    return hop ? { kind: 'redirect', redirectTo: hop.location } : { kind: 'missing' }
  }
  const [extras, page] = await Promise.all([
    rows<{ aliases: string[]; chars: { slug: string; name: string; color: string | null; n: number }[] }>(sql`
      select
        (select coalesce(array_agg(aa.alias order by aa.alias), '{}') from artist_aliases aa where aa.artist_id = ${entry.id}) as aliases,
        (select coalesce(json_agg(json_build_object('slug', s.slug, 'name', s.name, 'color', s.color, 'n', s.n) order by s.n desc, s.sort, s.slug), '[]'::json)
           from (
             select c.slug, c.name, c.theme_color as color, c.sort, count(distinct p.id)::int as n
             from pack_artists pa
             join packs p on p.id = pa.pack_id and p.status = 'published'
             join pack_characters pc on pc.pack_id = p.id
             join characters c on c.id = pc.character_id
             where pa.artist_id = ${entry.id}
             group by c.id, c.slug, c.name, c.theme_color, c.sort
           ) s) as chars`),
    packPage({ artist: i.slug }, { sort: i.sort, seed: i.seed, cursor: i.cursor, limit: i.limit }),
  ])
  const x = extras[0]
  return {
    kind: 'artist',
    artist: { ...entry.card, aliases: x?.aliases ?? [] },
    characters: (x?.chars ?? []).map((c) => ({ slug: c.slug, name: c.name, color: c.color ?? null, packCount: num(c.n) })),
    page,
  }
}
