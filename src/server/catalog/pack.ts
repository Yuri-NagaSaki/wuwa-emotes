import { sql } from 'drizzle-orm'
import { packArtistsJson, packCharactersJson, type RawCharacter, splitArtists, toCharacterRef } from './cards'
import { type RawImage, toEmojiImage, toEmojiImageOrNull } from './images'
import { emojiIdInput, packSlugInput } from './inputs'
import { resolveLegacyPath } from './legacy'
import { coverJson, emojiOrder, iso, num, PUB_AT, rows } from './sql'
import type {
  ArtistRole,
  EmojiPermalink,
  PackDetail,
  PackEmoji,
  PackKind,
  PackLookup,
  PackNeighbor,
  SourceKind,
  TagDimension,
  TagRef,
  TagsByDimension,
} from './types'

// /packs/:slug and /e/:emojiId. Two statements run in parallel (pack + neighbours, emoji list); an
// unknown slug then costs at most two more (redirects lookup, target check) in resolveLegacyPath.

interface DetailRow {
  id: number
  slug: string
  title: string
  excerpt: string | null
  description_md: string | null
  kind: PackKind
  source_kind: SourceKind
  license: string
  downloadable: boolean
  pin_level: number
  memorial: boolean
  commissioner: string | null
  credits_text: string | null
  source_url: string | null
  downloads: string | number
  favorites: number
  pub_at: Date
  updated_at: Date
  cover_emoji_id: string | null
  chars: RawCharacter[]
  arts: { slug: string; name: string; role: ArtistRole }[]
  tags: TagRef[]
  prev: { slug: string; title: string; cover: RawImage | null } | null
  next: { slug: string; title: string; cover: RawImage | null } | null
}

interface EmojiRow extends RawImage {
  format: string
  bytes: number
  duration_ms: number | null
  dominant_color: string | null
  chars: RawCharacter[]
}

const DIMENSIONS: TagDimension[] = ['group', 'tool', 'project', 'origin', 'custom']

function byDimension(tags: TagRef[]): TagsByDimension {
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, [] as TagRef[]])) as TagsByDimension
  for (const t of tags) out[t.dimension]?.push({ dimension: t.dimension, slug: t.slug, name: t.name })
  return out
}

function neighbor(n: DetailRow['prev']): PackNeighbor | null {
  return n ? { slug: n.slug, title: n.title, cover: toEmojiImageOrNull(n.cover) } : null
}

const NEIGHBOR_KEY = sql.raw('(coalesce(q.published_at, q.created_at), q.id)')

export async function getPackDetail(slugInput: string): Promise<PackLookup> {
  const { slug } = packSlugInput.parse({ slug: slugInput })
  const [main, emojiRows] = await Promise.all([
    rows<DetailRow>(sql`
      select p.id, p.slug, p.title, p.excerpt, p.description_md, p.kind, p.source_kind, p.license, p.downloadable,
        p.pin_level, p.memorial, p.commissioner, p.credits_text, p.source_url,
        p.download_count as downloads, p.favorite_count as favorites, ${PUB_AT} as pub_at, p.updated_at, p.cover_emoji_id,
        ${packCharactersJson('p')} as chars,
        ${packArtistsJson('p')} as arts,
        (select coalesce(json_agg(json_build_object('dimension', t.dimension, 'slug', t.slug, 'name', t.name)
                                  order by t.dimension, t.name, t.id), '[]'::json)
           from pack_tags pt join tags t on t.id = pt.tag_id where pt.pack_id = p.id) as tags,
        (select json_build_object('slug', q.slug, 'title', q.title, 'cover', ${coverJson('q')})
           from packs q where q.status = 'published' and ${NEIGHBOR_KEY} < (${PUB_AT}, p.id)
           order by coalesce(q.published_at, q.created_at) desc, q.id desc limit 1) as prev,
        (select json_build_object('slug', q.slug, 'title', q.title, 'cover', ${coverJson('q')})
           from packs q where q.status = 'published' and ${NEIGHBOR_KEY} > (${PUB_AT}, p.id)
           order by coalesce(q.published_at, q.created_at) asc, q.id asc limit 1) as next
      from packs p
      where p.slug = ${slug} and p.status = 'published'`),
    rows<EmojiRow>(sql`
      select e.id, e.storage_pack_key as k, e.variant_rev as r, e.width as w, e.height as h, e.frames as f,
        e.format, e.bytes, e.duration_ms, e.dominant_color,
        (select coalesce(json_agg(json_build_object('slug', c.slug, 'name', c.name, 'color', c.theme_color)
                                  order by c.sort, c.id), '[]'::json)
           from emoji_characters ec join characters c on c.id = ec.character_id where ec.emoji_id = e.id) as chars
      from emojis e join packs p on p.id = e.pack_id
      where p.slug = ${slug} and p.status = 'published' and e.status = 'published'
      order by ${emojiOrder('e')}`),
  ])

  const p = main[0]
  if (!p) {
    // renamed slug (redirects row or pack_key fallback); a draft/hidden pack is simply missing
    const hop = await resolveLegacyPath(`/packs/${slug}`)
    return hop ? { kind: 'redirect', redirectTo: hop.location } : { kind: 'missing' }
  }

  const emojis: PackEmoji[] = emojiRows.map((e, index) => ({
    ...toEmojiImage(e),
    index,
    format: e.format,
    bytes: num(e.bytes),
    durationMs: e.duration_ms ?? null,
    dominantColor: e.dominant_color ?? null,
    characters: (e.chars ?? []).map(toCharacterRef),
  }))
  const coverEmoji = emojis.find((e) => e.id === p.cover_emoji_id) ?? emojis[0]
  const characters = (p.chars ?? []).map(toCharacterRef)
  const { artists, commissioners } = splitArtists(p.arts)

  const pack: PackDetail = {
    id: num(p.id),
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? null,
    descriptionMd: p.description_md ?? null,
    kind: p.kind,
    sourceKind: p.source_kind,
    license: p.license,
    downloadable: !!p.downloadable,
    pinLevel: num(p.pin_level),
    memorial: !!p.memorial,
    count: emojis.length,
    downloads: num(p.downloads),
    favorites: num(p.favorites),
    publishedAt: iso(p.pub_at),
    updatedAt: iso(p.updated_at),
    accent: characters[0]?.color ?? null,
    cover: coverEmoji
      ? { id: coverEmoji.id, poster: coverEmoji.poster, preview: coverEmoji.preview, full: coverEmoji.full, width: coverEmoji.width, height: coverEmoji.height, frames: coverEmoji.frames }
      : null,
    emojis,
    characters,
    artists,
    commissioners,
    commissionerText: p.commissioner ?? null,
    creditsText: p.credits_text ?? null,
    sourceUrl: p.source_url ?? null,
    tags: byDimension(p.tags ?? []),
    prev: neighbor(p.prev),
    next: neighbor(p.next),
  }
  return { kind: 'pack', pack }
}

/** /e/:emojiId → pack slug + 0-based index in the pack's published emoji order; null if not public. */
export async function getEmojiPermalink(emojiIdValue: string): Promise<EmojiPermalink | null> {
  const parsed = emojiIdInput.safeParse({ emojiId: emojiIdValue })
  if (!parsed.success) return null
  const { emojiId } = parsed.data
  const list = await rows<{ slug: string; idx: number }>(sql`
    select p.slug, x.idx
    from (
      select e.id, e.pack_id, (row_number() over (order by ${emojiOrder('e')}) - 1)::int as idx
      from emojis e
      where e.status = 'published' and e.pack_id = (select pack_id from emojis where id = ${emojiId})
    ) x
    join packs p on p.id = x.pack_id and p.status = 'published'
    where x.id = ${emojiId}`)
  const r = list[0]
  return r ? { emojiId, packSlug: r.slug, index: num(r.idx) } : null
}
