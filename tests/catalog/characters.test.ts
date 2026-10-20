import { DATABASE_URL, withClient } from '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { clearCatalogCache } from '#/server/catalog/cache'
import { getArtistDetail } from '#/server/catalog/artists'
import { assignAvatars, getCharacterDetail, listCharacters, toPortrait } from '#/server/catalog/characters'
import { getFacets, getPackFacets } from '#/server/catalog/explore'
import { getHome } from '#/server/catalog/home'
import { getPackDetail } from '#/server/catalog/pack'
import { listPacks } from '#/server/catalog/packs'
import { searchCatalog, suggestCatalog } from '#/server/catalog/search'
import { getGallery } from '#/server/catalog/stream'
import type { CharacterCard } from '#/server/catalog/types'
import { characterCountText } from '#/shared/characters'
import { allPages } from './helpers'
import { PACK_BY_SLUG, seedCatalog } from './seed'

// Who a sticker belongs to (src/server/catalog/attribution.ts), on top of the shared fixture, with the
// shapes found in the v1 data: group packs whose stickers all carry the pack's whole character list
// (all-characters-pipa), a proper subset of it (official-abby-friends), a single character
// (xinyuehu-wuxue), two of two (frolova-…-gift); next to packs whose tags really vary per sticker and
// single-character packs with and without tags.

interface XEmoji {
  tags: string[]
  sha?: string
  ready?: boolean
}
interface XPack {
  slug: string
  title: string
  downloads: number
  chars: string[]
  emojis: XEmoji[]
}

const X_CHARACTERS: [slug: string, name: string, sort: number][] = [
  ['lupa', '露帕', 21],
  ['abu', '阿布', 22],
  ['guguhetun', '咕咕河豚', 23],
  ['tunzai', '豚仔', 24],
  ['danjin', '丹瑾', 25],
  ['jiyan', '忌炎', 26],
  ['yuehu', '月狐', 27],
  ['kakaluo', '卡卡罗', 28],
]

const ALL_PIPA = ['aimisi', 'feibi', 'danjin', 'jiyan', 'lupa']
const n = (count: number, e: XEmoji): XEmoji[] => Array.from({ length: count }, () => ({ ...e }))

// most downloaded first: under the old rule every group-pack character got g-pipa's first sticker
const X_PACKS: XPack[] = [
  { slug: 'g-pipa', title: '全角色琵琶曲', downloads: 9000, chars: ALL_PIPA, emojis: n(6, { tags: ALL_PIPA }) },
  { slug: 'g-abby', title: '阿布和朋友们', downloads: 8000, chars: ['abu', 'guguhetun', 'tunzai'], emojis: n(4, { tags: ['abu', 'guguhetun'] }) },
  { slug: 'g-xin', title: '心与月狐', downloads: 7000, chars: ['xin', 'yuehu'], emojis: n(5, { tags: ['xin'] }) },
  { slug: 'g-duo', title: '露帕和阿布', downloads: 6000, chars: ['lupa', 'abu'], emojis: n(4, { tags: ['lupa', 'abu'] }) },
  {
    slug: 'g-varied',
    title: '露帕阿布卡卡罗 逐张标注',
    downloads: 500,
    chars: ['lupa', 'abu', 'kakaluo'],
    emojis: [{ tags: ['lupa'] }, { tags: ['abu'] }, { tags: ['lupa', 'abu'] }, { tags: ['lupa'], sha: 'sha-lupa-2' }, { tags: ['kakaluo', 'lupa'] }],
  },
  // one guest tag in a single-character pack: that sticker is 阿布's, the untagged ones 露帕's
  { slug: 's-lupa', title: '露帕 日常', downloads: 400, chars: ['lupa'], emojis: [...n(3, { tags: [] }), { tags: ['abu'] }, { tags: [], ready: false }] },
  // copied tags in a single-character pack fall back to the pack's character
  { slug: 's-abu', title: '阿布 日常', downloads: 300, chars: ['abu'], emojis: n(3, { tags: ['abu', 'guguhetun'] }) },
  // the first sticker is the same image as 露帕's second avatar candidate
  { slug: 's-gugu', title: '咕咕河豚', downloads: 200, chars: ['guguhetun'], emojis: [{ tags: [], sha: 'sha-lupa-2' }, { tags: [] }] },
]

const xId = (pack: number, i: number) => `r-f${pack.toString(16).padStart(3, '0')}${i.toString(16).padStart(16, '0')}`
const idOf = (slug: string, i: number) => xId(X_PACKS.findIndex((p) => p.slug === slug) + 1, i)

/** Expected 张 / 包 / 合集包 / avatar for the added characters (and changes to the fixture's). */
const EXPECTED: Record<string, { emojis: number; packs: string[]; groups: string[]; avatar?: string | null }> = {
  lupa: { emojis: 7, packs: ['g-varied', 's-lupa'], groups: ['g-duo', 'g-pipa'], avatar: idOf('g-varied', 3) },
  abu: { emojis: 6, packs: ['g-varied', 's-abu', 's-lupa'], groups: ['g-abby', 'g-duo'], avatar: idOf('g-varied', 0) },
  // appears on 阿布's pack through its copied tags
  guguhetun: { emojis: 2, packs: ['s-gugu'], groups: ['g-abby', 's-abu'], avatar: idOf('s-gugu', 1) },
  kakaluo: { emojis: 1, packs: ['g-varied'], groups: [], avatar: null },
  aimisi: { emojis: 7 + 7 + 3, packs: ['aimisi-01', 'aimisi-02', 'multi-01'], groups: ['g-pipa'] },
  xin: { emojis: 6 + 5, packs: ['g-xin', 'xin-01'], groups: [] },
  // only in group packs whose stickers carry them all: listed, with 合集包 only
  danjin: { emojis: 0, packs: [], groups: ['g-pipa'], avatar: null },
  jiyan: { emojis: 0, packs: [], groups: ['g-pipa'], avatar: null },
  tunzai: { emojis: 0, packs: [], groups: ['g-abby'], avatar: null },
  yuehu: { emojis: 0, packs: [], groups: ['g-xin'], avatar: null },
}
const GROUP_ONLY = ['danjin', 'jiyan', 'tunzai', 'yuehu']
const COPIED_PACKS = ['g-pipa', 'g-abby', 'g-duo']

beforeAll(async () => {
  await seedCatalog()
  await withClient(DATABASE_URL, async (c) => {
    await c.query('begin')
    const charId = new Map<string, number>((await c.query(`select id, slug from characters`)).rows.map((r) => [r.slug, r.id]))
    for (const [slug, name, sort] of X_CHARACTERS) {
      const r = await c.query(`insert into characters (slug, name, sort, pack_count, emoji_count) values ($1, $2, $3, 999, 999) returning id`, [slug, name, sort])
      charId.set(slug, r.rows[0].id)
    }
    for (const [pi, p] of X_PACKS.entries()) {
      const r = await c.query(
        `insert into packs (pack_key, slug, title, status, kind, download_count, published_at, created_at)
         values ($1, $1, $2, 'published', 'static', $3, '2026-09-30 00:00:00+00', '2026-08-01 00:00:00+00') returning id`,
        [p.slug, p.title, p.downloads],
      )
      const packId = r.rows[0].id
      for (const ch of p.chars) await c.query(`insert into pack_characters (pack_id, character_id) values ($1, $2)`, [packId, charId.get(ch)])
      for (const [i, e] of p.emojis.entries()) {
        const id = xId(pi + 1, i)
        await c.query(
          `insert into emojis (id, pack_id, storage_pack_key, status, sort_order, original_key, format, mime, bytes, width, height, frames, derived_ready, sha256)
           values ($1, $2, $3, 'published', $4, $5, 'png', 'image/png', $6, 300, 300, 1, $7, $8)`,
          [id, packId, p.slug, i, `assets/v1/packs/${p.slug}/emojis/${id}.png`, 50_000 + pi * 100 + i, e.ready ?? true, e.sha ?? null],
        )
        for (const t of e.tags) await c.query(`insert into emoji_characters (emoji_id, character_id) values ($1, $2)`, [id, charId.get(t)])
      }
    }
    // an artist who drew the group pack and 露帕's own pack
    const art = await c.query(`insert into artists (slug, name) values ('pipahua', '琵琶画师') returning id`)
    for (const slug of ['g-pipa', 's-lupa']) {
      await c.query(`insert into pack_artists (pack_id, artist_id, role) select id, $1, 'artist' from packs where slug = $2`, [art.rows[0].id, slug])
    }
    // admin override: 阿布's avatar is 露帕's best sticker, so 露帕 has to take its next one
    await c.query(`update characters set avatar_emoji_id = $1 where slug = 'abu'`, [idOf('g-varied', 0)])
    await c.query('commit')
  })
  clearCatalogCache()
}, 120_000)

async function card(slug: string): Promise<CharacterCard | undefined> {
  return (await listCharacters()).find((c) => c.slug === slug)
}

describe('attribution: 张, 包 and 合集包', () => {
  test('stickers of copied-tag group packs belong to nobody; varied tags and single-character packs count', async () => {
    for (const [slug, want] of Object.entries(EXPECTED)) {
      const c = await card(slug)
      expect(c, slug).toBeDefined()
      expect({ slug, emojis: c!.emojiCount, packs: c!.packCount, groups: c!.groupCount }).toEqual({
        slug,
        emojis: want.emojis,
        packs: want.packs.length,
        groups: want.groups.length,
      })
    }
  })

  test('characters only in group packs are listed with their 合集包 and get a normal page', async () => {
    const list = await listCharacters()
    const home = await getHome()
    const facets = await getFacets()
    const packFacets = await getPackFacets()
    for (const slug of GROUP_ONLY) {
      const c = list.find((x) => x.slug === slug)!
      expect(characterCountText(c)).toBe('出现在 1 个合集包')
      // no stickers of its own: not in the sticker-ordered strip, the /packs facets or the 包 filter
      expect(home.characters.map((x) => x.slug)).not.toContain(slug)
      expect(facets.characters.map((x) => x.slug)).not.toContain(slug)
      expect(packFacets.characters.map((x) => x.slug)).not.toContain(slug)
      expect((await listPacks({ character: slug })).items).toEqual([])
      expect((await getGallery({ character: slug })).items).toEqual([])
      // the page opens on its 合集包
      const d = await getCharacterDetail({ slug })
      if (d.kind !== 'character' || d.tab !== 'groups') throw new Error(`no 合集包 page for ${slug}`)
      expect(d.page.items.map((p) => p.slug)).toEqual(EXPECTED[slug]!.groups)
    }
    expect(home.stats.characters).toBe(list.length)
    const r = await searchCatalog({ q: '丹瑾' })
    expect(r.characters.map((c) => c.slug)).toEqual(['danjin'])
    expect(r.packs.map((p) => p.slug)).toContain('g-pipa')
    expect((await suggestCatalog({ q: '丹瑾' })).find((x) => x.slug === 'danjin')?.sub).toBe('出现在 1 个合集包')
  })

  test('order: most stickers, then most 合集包, then pinyin', async () => {
    const list = await listCharacters()
    const sorted = [...list].sort((a, b) => b.emojiCount - a.emojiCount || b.groupCount - a.groupCount || a.slug.localeCompare(b.slug))
    expect(list.map((c) => c.slug)).toEqual(sorted.map((c) => c.slug))
    expect(list.slice(-4).map((c) => c.slug)).toEqual(['danjin', 'jiyan', 'tunzai', 'yuehu'])
  })

  test('no two rows read the same: unique art, and never 0 张 or a group pack count', async () => {
    const list = await listCharacters()
    const art = list.map((c) => c.portrait?.src ?? c.avatar?.id ?? `initial:${Array.from(c.name)[0]}`)
    expect(new Set(art).size).toBe(art.length)
    const rows = list.map((c, i) => `${art[i]}|${characterCountText(c)}`)
    expect(new Set(rows).size).toBe(rows.length)
    for (const c of list) expect(characterCountText(c)).not.toMatch(/^0 张/)
    // the copied pack's 6 stickers are nobody's count
    for (const slug of ALL_PIPA) expect(characterCountText((await card(slug))!)).not.toMatch(/^6 张/)
  })

  test('张, 包 and 合集 agree on every surface: list, detail tabs, gallery, /packs filters, facets, home, search', async () => {
    const list = await listCharacters()
    const home = await getHome()
    const facets = await getFacets()
    const packFacets = await getPackFacets()
    for (const c of list) {
      const detail = await getCharacterDetail({ slug: c.slug })
      if (detail.kind !== 'character') throw new Error(`no page for ${c.slug}`)
      expect(detail.character).toMatchObject({ emojiCount: c.emojiCount, packCount: c.packCount, groupCount: c.groupCount })

      // 合集包: the detail tab and the /packs groupOf filter
      const groups = await allPages((cursor) => listPacks({ groupOf: c.slug, cursor, limit: 2 }))
      const tabGroups = await allPages(async (cursor) => {
        const d = await getCharacterDetail({ slug: c.slug, tab: 'groups', cursor, limit: 2 })
        if (d.kind !== 'character' || d.tab !== 'groups') throw new Error('expected the groups tab')
        return d.page
      })
      expect(groups.items.length).toBe(c.groupCount)
      expect(tabGroups.items.map((p) => p.slug).sort()).toEqual(groups.items.map((p) => p.slug).sort())
      if (EXPECTED[c.slug]) expect(groups.items.map((p) => p.slug).sort()).toEqual([...EXPECTED[c.slug]!.groups].sort())
      if (!c.emojiCount) continue

      const tabEmojis = await allPages(async (cursor) => {
        const d = await getCharacterDetail({ slug: c.slug, tab: 'emojis', cursor, limit: 4 })
        if (d.kind !== 'character' || d.tab !== 'emojis') throw new Error('expected the emojis tab')
        return d.page
      })
      const gallery = await allPages((cursor) => getGallery({ character: c.slug, cursor, limit: 5 }))
      expect(new Set(tabEmojis.items.map((e) => e.id)).size).toBe(c.emojiCount)
      expect(gallery.items.map((e) => e.id).sort()).toEqual(tabEmojis.items.map((e) => e.id).sort())

      const packs = await allPages((cursor) => listPacks({ character: c.slug, cursor, limit: 2 }))
      const tabPacks = await allPages(async (cursor) => {
        const d = await getCharacterDetail({ slug: c.slug, tab: 'packs', cursor, limit: 2 })
        if (d.kind !== 'character' || d.tab !== 'packs') throw new Error('expected the packs tab')
        return d.page
      })
      expect(packs.items.length).toBe(c.packCount)
      expect(tabPacks.items.map((p) => p.slug).sort()).toEqual(packs.items.map((p) => p.slug).sort())
      // 包 = packs holding at least one of the character's stickers
      expect(new Set(gallery.items.map((e) => e.pack.slug))).toEqual(new Set(packs.items.map((p) => p.slug)))

      const want = EXPECTED[c.slug]
      if (want) expect(packs.items.map((p) => p.slug).sort()).toEqual([...want.packs].sort())
      for (const slug of COPIED_PACKS) expect(gallery.items.map((e) => e.pack.slug)).not.toContain(slug)

      expect(facets.characters.find((f) => f.slug === c.slug)?.packCount).toBe(c.packCount)
      expect(packFacets.characters.find((f) => f.slug === c.slug)?.packCount).toBe(c.packCount)
      const h = home.characters.find((x) => x.slug === c.slug)
      if (h) expect(h).toMatchObject({ emojiCount: c.emojiCount, packCount: c.packCount, groupCount: c.groupCount })
      const hit = (await searchCatalog({ q: c.name })).characters.find((x) => x.slug === c.slug)
      expect(hit, c.name).toMatchObject({ emojiCount: c.emojiCount, packCount: c.packCount, groupCount: c.groupCount })
    }
    const s = (await suggestCatalog({ q: '露帕' })).find((x) => x.type === 'character' && x.slug === 'lupa')
    expect(s?.sub).toBe('7 张 · 2 包')
  })

  test('the character page lists the artists of the packs it appears on', async () => {
    const d = await getCharacterDetail({ slug: 'aimisi' })
    if (d.kind !== 'character') throw new Error('expected a character')
    expect(d.artists.map((a) => a.slug)).toEqual(['maowushi', 'pipahua'])
    const g = await getCharacterDetail({ slug: 'danjin' })
    if (g.kind !== 'character') throw new Error('expected a character')
    expect(g.artists.map((a) => a.slug)).toEqual(['pipahua'])
  })

  test('the artist page lists characters with stickers of their own in its packs, not the names on a group pack', async () => {
    const d = await getArtistDetail({ slug: 'pipahua' })
    if (d.kind !== 'artist') throw new Error('expected an artist')
    expect(d.characters.map((c) => [c.slug, c.packCount])).toEqual([
      ['lupa', 1],
      ['abu', 1],
    ])
  })
})

describe('avatars', () => {
  test('no two characters share an avatar, by id or by image', async () => {
    const list = await listCharacters()
    const ids = list.flatMap((c) => (c.avatar ? [c.avatar.id] : []))
    expect(new Set(ids).size).toBe(ids.length)
    const sha = new Map<string, string>()
    for (const p of X_PACKS) for (const [i, e] of p.emojis.entries()) if (e.sha) sha.set(idOf(p.slug, i), e.sha)
    const images = ids.map((id) => sha.get(id) ?? id)
    expect(new Set(images).size).toBe(images.length)
    // the same holds where avatars are shown elsewhere
    const facetAvatars = (await getPackFacets()).characters.flatMap((c) => (c.avatar ? [c.avatar] : []))
    expect(new Set(facetAvatars).size).toBe(facetAvatars.length)
  })

  test('an avatar is a sticker of that character alone; override first, then the next free one, else null', async () => {
    for (const [slug, want] of Object.entries(EXPECTED)) {
      if (want.avatar !== undefined) expect({ slug, avatar: (await card(slug))!.avatar?.id ?? null }).toEqual({ slug, avatar: want.avatar })
    }
    // never art from a copied-tag group pack
    for (const c of await listCharacters()) {
      for (const slug of COPIED_PACKS) expect(c.avatar?.poster ?? '').not.toContain(`/${slug}/`)
    }
    // automatic picks are attributed to exactly this character (阿布's is an admin override)
    const packOf = (id: string) => (X_PACKS.find((p, pi) => p.emojis.some((_, i) => xId(pi + 1, i) === id)) ?? null)
    for (const slug of ['lupa', 'guguhetun']) {
      const id = (await card(slug))!.avatar!.id
      const p = packOf(id)!
      const e = p.emojis.find((_, i) => idOf(p.slug, i) === id)!
      expect(e.tags.length ? e.tags : p.chars).toEqual([slug])
    }
  })

  test('the fixture avatars keep their rules (override, hidden-pack override falls back)', async () => {
    expect((await card('changli'))!.avatar!.id).toBe(PACK_BY_SLUG['changli-01']!.emojis[2]!.id)
    expect(PACK_BY_SLUG['yangyang-01']!.emojis.map((e) => e.id)).toContain((await card('yangyang'))!.avatar!.id)
  })

  test('assignAvatars: overrides are claimed first; a taken image is skipped; nothing free gives null', () => {
    const img = (id: string) => ({ id, k: 'p', r: 1, w: 300, h: 300, f: 1 })
    const out = assignAvatars([
      { id: 1, own: null, candidates: [{ img: img('a'), key: 'A' }, { img: img('b'), key: 'B' }] },
      { id: 2, own: { img: img('a2'), key: 'A' }, candidates: [{ img: img('c'), key: 'C' }] },
      { id: 3, own: { img: img('a3'), key: 'A' }, candidates: [{ img: img('b2'), key: 'B' }] },
      { id: 4, own: null, candidates: [{ img: img('c2'), key: 'C' }] },
      { id: 5, own: null, candidates: null },
    ])
    expect([...out.entries()].map(([k, v]) => [k, v?.id ?? null])).toEqual([
      [2, 'a2'],
      [1, 'b'],
      [3, null],
      [4, 'c2'],
      [5, null],
    ])
  })
})

describe('pack pages still show who appears in a group pack', () => {
  test('g-pipa lists all its characters even though none of them owns its stickers', async () => {
    const d = await getPackDetail('g-pipa')
    if (d.kind !== 'pack') throw new Error('expected a pack')
    expect(d.pack.characters.map((c) => c.slug).sort()).toEqual([...ALL_PIPA].sort())
  })
})

describe('portraits', () => {
  test('portrait_key → src, srcset and a 3:4 size; malformed keys are no portrait', () => {
    expect(toPortrait('characters/v1/portraits/aimisi.0a1b2c3d-480.webp')).toEqual({
      src: '/img/v1/portrait/aimisi.0a1b2c3d-240.webp',
      srcSet: '/img/v1/portrait/aimisi.0a1b2c3d-240.webp 240w, /img/v1/portrait/aimisi.0a1b2c3d-480.webp 480w',
      width: 480,
      height: 640,
    })
    expect(toPortrait('characters/v1/portraits/lupa.ffffffff-240.webp')).toMatchObject({ srcSet: '/img/v1/portrait/lupa.ffffffff-240.webp 240w', height: 320 })
    for (const bad of [null, '', 'characters/v1/portraits/aimisi.0a1b2c3d-300.webp', 'derived/v1/p240/x/r-0.webp', 'characters/v1/portraits/../x.0a1b2c3d-240.webp'])
      expect(toPortrait(bad)).toBeNull()
  })

  test('cards carry the stored portrait', async () => {
    await withClient(DATABASE_URL, (c) => c.query(`update characters set portrait_key = 'characters/v1/portraits/lupa.0a1b2c3d-240.webp' where slug = 'lupa'`))
    clearCatalogCache()
    expect((await card('lupa'))!.portrait).toMatchObject({ src: '/img/v1/portrait/lupa.0a1b2c3d-240.webp', width: 240, height: 320 })
    expect((await card('abu'))!.portrait).toBeNull()
  })
})
