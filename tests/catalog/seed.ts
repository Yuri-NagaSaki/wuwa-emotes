import { DATABASE_URL, mainDatabase, withClient } from '../integration/setup'
import { clearCatalogCache } from '#/server/catalog/cache'

// A realistic catalog fixture in a fresh, migrated database (CHAOCHI_TEST_DB). Import this module
// after ../integration/setup and call seedCatalog() in beforeAll; the seed runs once per process.
//
// Published: 10 packs. Never visible: a draft pack (with published + pending emojis), a hidden pack
// (with published emojis), pending/hidden emojis inside published packs, a character / artist / tag
// used only by the draft, an unpublished collection, a published collection holding only the draft.
// Ties on purpose: download_count (P2 = P3, P7 = P8), favorite_count (P1 = P2 = P6), published_at
// (P3 = P9); timestamps carry microseconds; P8 has no published_at.

export type Status = 'published' | 'pending' | 'hidden'

export interface FxEmoji {
  id: string
  status: Status
  frames: number
  w: number | null
  h: number | null
  rev: number
  sort: number
  /** SQL timestamptz literal or 'now' */
  createdAt: string
  storageKey: string
  format: string
  bytes: number
  chars: string[]
}

export interface FxPack {
  key: string
  slug: string
  title: string
  status: 'published' | 'draft' | 'hidden'
  kind: 'animated' | 'static' | 'mixed'
  source: 'community' | 'official'
  downloads: number
  favorites: number
  pin: number
  memorial: boolean
  /** null, a timestamptz literal, or 'now' */
  publishedAt: string | null
  createdAt: string
  downloadable: boolean
  license: string
  commissioner: string | null
  credits: string | null
  sourceUrl: string | null
  legacyPostName: string | null
  chars: string[]
  artists: [string, 'artist' | 'commissioner'][]
  tags: [string, string][]
  emojis: FxEmoji[]
  /** index into emojis; may point at an unpublished one */
  cover: number | null
}

export interface FxCharacter {
  slug: string
  name: string
  color: string
  sort: number
  aliases: string[]
  legacySlug: string | null
  /** [packNo, emoji index] */
  avatar: [number, number] | null
}

export interface FxArtist {
  slug: string
  name: string
  aliases: string[]
  legacySlug: string | null
  links: { label: string; url: string }[]
}

const OLD = '2026-08-01 00:00:00+00'

let packNo = 0
function emojiId(pack: number, n: number): string {
  return `r-${pack.toString(16).padStart(4, '0')}${n.toString(16).padStart(16, '0')}`
}

interface EmojiSpec {
  status?: Status
  frames?: number
  w?: number | null
  h?: number | null
  rev?: number
  sort?: number
  createdAt?: string
  storageKey?: string
  chars?: string[]
}

function pack(p: Omit<FxPack, 'emojis' | 'cover'> & { cover?: number | null }, specs: EmojiSpec[]): FxPack {
  const no = ++packNo
  const emojis = specs.map((s, i): FxEmoji => {
    const frames = s.frames ?? (p.kind === 'static' ? 1 : 12)
    return {
      id: emojiId(no, i + 1),
      status: s.status ?? 'published',
      frames,
      w: s.w === undefined ? 300 : s.w,
      h: s.h === undefined ? 300 : s.h,
      rev: s.rev ?? 1,
      sort: s.sort ?? i,
      createdAt: s.createdAt ?? `2026-08-01 00:00:${String(i).padStart(2, '0')}.000${String(i).padStart(3, '0')}+00`,
      storageKey: s.storageKey ?? p.key,
      format: frames > 1 ? 'gif' : 'png',
      bytes: 10_000 + no * 100 + i,
      chars: s.chars ?? p.chars.slice(0, 1),
    }
  })
  return { ...p, cover: p.cover ?? null, emojis }
}

const base = {
  source: 'community' as const,
  pin: 0,
  memorial: false,
  createdAt: OLD,
  downloadable: false,
  license: 'unknown',
  commissioner: null,
  credits: null,
  sourceUrl: null,
  legacyPostName: null,
  artists: [] as [string, 'artist' | 'commissioner'][],
  tags: [] as [string, string][],
}
const n = (count: number, spec: EmojiSpec = {}): EmojiSpec[] => Array.from({ length: count }, () => ({ ...spec }))

export const PACKS: FxPack[] = [
  // P1: cover points at a pending emoji; one pending + one hidden emoji; one emoji ingested today
  pack(
    {
      ...base,
      key: 'aimisi-01',
      slug: 'aimisi-01',
      title: '爱弥斯动态表情包（板牌）',
      status: 'published',
      kind: 'animated',
      downloads: 5000,
      favorites: 100,
      pin: 2,
      publishedAt: '2026-09-01 10:00:00.123456+00',
      downloadable: true,
      license: 'CC BY-NC-SA 4.0',
      chars: ['aimisi'],
      artists: [['maowushi', 'artist']],
      tags: [['group', 'zhanzhang-tuijian']],
      cover: 6,
    },
    [...n(5), { rev: 3 }, { status: 'pending' }, { status: 'hidden' }, { createdAt: 'now', sort: 99 }],
  ),
  // P2: non-square statics; one emoji still stored under aimisi-01 (moved between packs)
  pack(
    {
      ...base,
      key: 'aimisi-02',
      slug: 'aimisi-02',
      title: '爱弥斯 捏捏 静态',
      status: 'published',
      kind: 'static',
      downloads: 3000,
      favorites: 100,
      publishedAt: '2026-09-05 08:00:00.000001+00',
      chars: ['aimisi'],
      artists: [['maowushi', 'artist']],
    },
    [...n(3, { w: 240, h: 180 }), { storageKey: 'aimisi-01', rev: 2 }, ...n(3)],
  ),
  // P3: one emoji without probed dimensions
  pack(
    {
      ...base,
      key: 'xin-01',
      slug: 'xin-01',
      title: '心 日常',
      status: 'published',
      kind: 'static',
      downloads: 3000,
      favorites: 50,
      publishedAt: '2026-09-10 12:00:00.654321+00',
      chars: ['xin'],
    },
    [{ w: null, h: null }, ...n(5)],
  ),
  // P4
  pack(
    {
      ...base,
      key: 'xinyuehu-01',
      slug: 'xinyuehu-01',
      title: '心月狐 动图',
      status: 'published',
      kind: 'mixed',
      downloads: 800,
      favorites: 20,
      memorial: true,
      publishedAt: '2026-09-12 00:00:00.5+00',
      chars: ['xinyuehu'],
    },
    [...n(3, { frames: 12 }), ...n(3, { frames: 1 })],
  ),
  // P5: credits split (artist + commissioner entity + free-text commissioner); equal sort_order, so
  // created_at decides the order (ids run the other way)
  pack(
    {
      ...base,
      key: 'feibi-01',
      slug: 'feibi-01',
      title: '菲比的一天',
      status: 'published',
      kind: 'animated',
      downloads: 1200,
      favorites: 80,
      publishedAt: '2026-09-15 09:30:00.111111+00',
      downloadable: true,
      license: 'CC BY-NC-SA 4.0',
      commissioner: '黑羽',
      credits: '画师：爱秧斯坦；约稿：黑羽',
      sourceUrl: 'https://example.com/feibi',
      chars: ['feibi'],
      artists: [
        ['爱秧斯坦', 'artist'],
        ['kuroba', 'commissioner'],
      ],
      tags: [['tool', 'ps']],
    },
    [5, 4, 3, 2, 1, 0].map((k) => ({ sort: 0, createdAt: `2026-08-02 00:00:0${k}.000001+00` })),
  ),
  // P6: multi-character pack with emoji-level tags; accent = first character by characters.sort
  pack(
    {
      ...base,
      key: 'multi-01',
      slug: 'multi-01',
      title: '全角色琵琶曲 v2.0',
      status: 'published',
      kind: 'animated',
      downloads: 2500,
      favorites: 100,
      publishedAt: '2026-09-20 18:00:00.999999+00',
      chars: ['jinxi', 'feibi', 'aimisi'],
    },
    [...n(3, { chars: ['aimisi'] }), ...n(3, { chars: ['feibi'] }), ...n(3, { chars: ['jinxi'] })],
  ),
  // P7: official, preview only
  pack(
    {
      ...base,
      key: 'official-01',
      slug: 'official-01',
      title: '官方表情 第一弹',
      status: 'published',
      kind: 'static',
      source: 'official',
      downloads: 0,
      favorites: 0,
      publishedAt: '2026-09-22 10:00:00+00',
      chars: ['jinxi'],
    },
    n(6),
  ),
  // P8: no published_at (ordering falls back to created_at)
  pack(
    {
      ...base,
      key: 'chun-01',
      slug: 'chun-01',
      title: '椿 合集',
      status: 'published',
      kind: 'static',
      downloads: 0,
      favorites: 0,
      publishedAt: null,
      createdAt: '2026-09-25 10:00:00.250000+00',
      chars: ['chun'],
    },
    n(6),
  ),
  // P9: same published_at as P3
  pack(
    {
      ...base,
      key: 'changli-01',
      slug: 'changli-01',
      title: '长离 表情',
      status: 'published',
      kind: 'static',
      downloads: 450,
      favorites: 5,
      publishedAt: '2026-09-10 12:00:00.654321+00',
      chars: ['changli'],
    },
    n(5),
  ),
  // P10: draft with published and pending emojis; would top every list if it leaked
  pack(
    {
      ...base,
      key: 'draft-01',
      slug: 'draft-01',
      title: '草稿 守岸人',
      status: 'draft',
      kind: 'static',
      downloads: 99999,
      favorites: 9999,
      pin: 5,
      publishedAt: '2026-10-01 00:00:00+00',
      chars: ['shouanren'],
      artists: [['ghost', 'artist']],
      tags: [['custom', 'draft-only']],
    },
    [...n(4), ...n(2, { status: 'pending' })],
  ),
  // P11: hidden pack with published emojis (秧秧's avatar points here)
  pack(
    {
      ...base,
      key: 'hidden-01',
      slug: 'hidden-01',
      title: '隐藏 秧秧',
      status: 'hidden',
      kind: 'static',
      downloads: 88888,
      favorites: 8888,
      pin: 3,
      publishedAt: '2026-10-02 00:00:00+00',
      chars: ['yangyang'],
      tags: [['group', 'zhanzhang-tuijian']],
    },
    n(5),
  ),
  // P12: renamed (pack_key = first slug), published today
  pack(
    {
      ...base,
      key: 'yangyang-old',
      slug: 'yangyang-01',
      title: '秧秧 静态合集（爱秧斯坦）',
      status: 'published',
      kind: 'static',
      downloads: 300,
      favorites: 10,
      publishedAt: 'now',
      legacyPostName: 'emoji-post-yy',
      chars: ['yangyang'],
      artists: [['爱秧斯坦', 'artist']],
      tags: [['project', 'solar5']],
    },
    n(6, { createdAt: 'now' }),
  ),
]

export const PACK_BY_SLUG = Object.fromEntries(PACKS.map((p) => [p.slug, p]))
export const PUBLIC_PACKS = PACKS.filter((p) => p.status === 'published')
export const HIDDEN_PACKS = PACKS.filter((p) => p.status !== 'published')
export const PUBLIC_EMOJI_IDS = new Set(PUBLIC_PACKS.flatMap((p) => p.emojis.filter((e) => e.status === 'published').map((e) => e.id)))
export const FORBIDDEN_EMOJI_IDS = new Set(PACKS.flatMap((p) => p.emojis.map((e) => e.id)).filter((id) => !PUBLIC_EMOJI_IDS.has(id)))

export const CHARACTERS: FxCharacter[] = [
  { slug: 'aimisi', name: '爱弥斯', color: 'pink', sort: 1, aliases: ['Aimisi'], legacySlug: 'character-1e2ca573335a00cc88b0a81f', avatar: null },
  { slug: 'xin', name: '心', color: 'red', sort: 2, aliases: [], legacySlug: 'abc123hash', avatar: null },
  { slug: 'feibi', name: '菲比', color: 'blue', sort: 3, aliases: ['Phoebe'], legacySlug: null, avatar: null },
  { slug: 'jinxi', name: '今汐', color: 'yellow', sort: 4, aliases: [], legacySlug: null, avatar: null },
  { slug: 'xinyuehu', name: '心月狐', color: 'purple', sort: 5, aliases: ['狐狐'], legacySlug: null, avatar: null },
  { slug: 'chun', name: '椿', color: 'peach', sort: 6, aliases: [], legacySlug: 'old-chun', avatar: null },
  { slug: 'changli', name: '长离', color: 'orange', sort: 7, aliases: ['离'], legacySlug: null, avatar: [9, 2] },
  { slug: 'yangyang', name: '秧秧', color: 'green', sort: 8, aliases: ['秧'], legacySlug: 'yangyang-legacy', avatar: [11, 0] },
  { slug: 'shouanren', name: '守岸人', color: 'teal', sort: 9, aliases: ['守岸'], legacySlug: 'shouanren-old', avatar: [10, 0] },
]

export const ARTISTS: FxArtist[] = [
  {
    slug: 'maowushi',
    name: '猫屋敷梨梨',
    aliases: ['Haruya'],
    legacySlug: 'maowushi-old',
    links: [
      { label: 'B站', url: 'https://space.bilibili.com/1' },
      { label: 'bad', url: 'javascript:alert(1)' },
    ],
  },
  { slug: '爱秧斯坦', name: '爱秧斯坦', aliases: ['AiEinstein'], legacySlug: null, links: [] },
  { slug: 'kuroba', name: '黑羽', aliases: [], legacySlug: null, links: [] },
  { slug: 'ghost', name: '幽灵画师', aliases: ['GhostArtist'], legacySlug: 'ghost-old', links: [] },
]

export const TAGS: [string, string, string][] = [
  ['group', 'zhanzhang-tuijian', '站长推荐'],
  ['tool', 'ps', 'Photoshop'],
  ['project', 'solar5', '企划/Solar5'],
  ['custom', 'draft-only', '草稿专用'],
]

export const COLLECTIONS: { slug: string; title: string; published: boolean; sort: number; packs: string[] }[] = [
  { slug: 'drafts-only', title: '只有草稿的合集', published: true, sort: 0, packs: ['draft-01'] },
  { slug: 'secret', title: '未发布合集', published: false, sort: -1, packs: ['aimisi-02'] },
  { slug: 'featured', title: '站长精选', published: true, sort: 1, packs: ['feibi-01', 'aimisi-01', 'draft-01'] },
]

export const REDIRECTS: [string, string, number][] = [
  ['/packs/yangyang-legacy-slug', '/packs/yangyang-01', 301],
  ['/archives/old-feibi-post', '/packs/feibi-01', 301],
  ['/tags/character-zzz', '/characters/xin', 302],
  ['/old/a', '/old/b', 301],
  ['/old/b', '/packs/aimisi-01', 301],
  ['/packs/to-draft', '/packs/draft-01', 301],
  ['/loop/a', '/loop/b', 301],
  ['/loop/b', '/loop/a', 301],
  ['/ext', 'https://evil.example/x', 301],
  ['/characters/old-chun-2', '/characters/chun', 301],
  ['/characters/to-hidden', '/characters/shouanren', 301],
  ['/tags/中文标签', '/packs/xin-01', 308],
]

/** Strings that must never appear in any public result. */
export const FORBIDDEN_STRINGS = [
  'draft-01',
  'hidden-01',
  '草稿 守岸人',
  '隐藏 秧秧',
  '守岸人',
  'shouanren',
  'ghost',
  '幽灵画师',
  '草稿专用',
  'draft-only',
  '未发布合集',
  '只有草稿的合集',
]

const ts = (v: string) => (v === 'now' ? 'now()' : `'${v}'::timestamptz`)

async function doSeed(): Promise<void> {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
  await withClient(DATABASE_URL, async (c) => {
    await c.query('begin')
    const charId = new Map<string, number>()
    for (const ch of CHARACTERS) {
      const r = await c.query(
        `insert into characters (slug, name, theme_color, sort, legacy_slug, pack_count, emoji_count) values ($1, $2, $3, $4, $5, 999, 999) returning id`,
        [ch.slug, ch.name, ch.color, ch.sort, ch.legacySlug],
      )
      charId.set(ch.slug, r.rows[0].id)
      for (const a of ch.aliases) await c.query(`insert into character_aliases (character_id, alias) values ($1, $2)`, [r.rows[0].id, a])
    }
    const artistId = new Map<string, number>()
    for (const a of ARTISTS) {
      const r = await c.query(`insert into artists (slug, name, legacy_slug, links, pack_count) values ($1, $2, $3, $4, 999) returning id`, [
        a.slug,
        a.name,
        a.legacySlug,
        JSON.stringify(a.links),
      ])
      artistId.set(a.slug, r.rows[0].id)
      for (const al of a.aliases) await c.query(`insert into artist_aliases (artist_id, alias) values ($1, $2)`, [r.rows[0].id, al])
    }
    const tagId = new Map<string, number>()
    for (const [dim, slug, name] of TAGS) {
      const r = await c.query(`insert into tags (dimension, slug, name) values ($1, $2, $3) returning id`, [dim, slug, name])
      tagId.set(`${dim}:${slug}`, r.rows[0].id)
    }
    const packId = new Map<string, number>()
    for (const p of PACKS) {
      const r = await c.query(
        `insert into packs (pack_key, slug, title, status, source_kind, license, downloadable, kind, pin_level, memorial, commissioner,
                            credits_text, source_url, legacy_post_name, cover_emoji_id, emoji_count, download_count, favorite_count,
                            published_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 999, $16, $17,
                 ${p.publishedAt ? ts(p.publishedAt) : 'null'}, ${ts(p.createdAt)})
         returning id`,
        [
          p.key,
          p.slug,
          p.title,
          p.status,
          p.source,
          p.license,
          p.downloadable,
          p.kind,
          p.pin,
          p.memorial,
          p.commissioner,
          p.credits,
          p.sourceUrl,
          p.legacyPostName,
          p.cover === null ? null : p.emojis[p.cover]!.id,
          p.downloads,
          p.favorites,
        ],
      )
      const id = r.rows[0].id as number
      packId.set(p.slug, id)
      for (const ch of p.chars) await c.query(`insert into pack_characters (pack_id, character_id) values ($1, $2)`, [id, charId.get(ch)])
      for (const [a, role] of p.artists) await c.query(`insert into pack_artists (pack_id, artist_id, role) values ($1, $2, $3)`, [id, artistId.get(a), role])
      for (const [dim, slug] of p.tags) await c.query(`insert into pack_tags (pack_id, tag_id) values ($1, $2)`, [id, tagId.get(`${dim}:${slug}`)])
      for (const e of p.emojis) {
        await c.query(
          `insert into emojis (id, pack_id, storage_pack_key, status, sort_order, original_key, format, mime, bytes, width, height, frames,
                               variant_rev, derived_ready, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, ${ts(e.createdAt)})`,
          [
            e.id,
            id,
            e.storageKey,
            e.status,
            e.sort,
            `assets/v1/packs/${e.storageKey}/emojis/${e.id}.${e.format}`,
            e.format,
            `image/${e.format}`,
            e.bytes,
            e.w,
            e.h,
            e.frames,
            e.rev,
          ],
        )
        for (const ch of e.chars) await c.query(`insert into emoji_characters (emoji_id, character_id) values ($1, $2)`, [e.id, charId.get(ch)])
      }
    }
    for (const ch of CHARACTERS) {
      if (!ch.avatar) continue
      const [no, idx] = ch.avatar
      await c.query(`update characters set avatar_emoji_id = $1 where slug = $2`, [PACKS[no - 1]!.emojis[idx]!.id, ch.slug])
    }
    for (const col of COLLECTIONS) {
      const r = await c.query(`insert into collections (slug, title, published, sort) values ($1, $2, $3, $4) returning id`, [
        col.slug,
        col.title,
        col.published,
        col.sort,
      ])
      for (const [i, slug] of col.packs.entries()) {
        await c.query(`insert into collection_packs (collection_id, pack_id, sort) values ($1, $2, $3)`, [r.rows[0].id, packId.get(slug), i])
      }
    }
    for (const [from, to, code] of REDIRECTS) await c.query(`insert into redirects (from_path, to_path, code) values ($1, $2, $3)`, [from, to, code])
    await c.query('commit')
  })
  clearCatalogCache()
}

let seeded: Promise<void> | undefined
export function seedCatalog(): Promise<void> {
  seeded ??= doSeed()
  return seeded
}
