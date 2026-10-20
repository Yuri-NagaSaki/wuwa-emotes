import '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { getCharacterDetail } from '#/server/catalog/characters'
import { CatalogInputError, encodeCursor } from '#/server/catalog/cursor'
import { listPacks } from '#/server/catalog/packs'
import { getGallery } from '#/server/catalog/stream'
import type { PackCard, PackSort } from '#/server/catalog/types'
import { allPages } from './helpers'
import { PACK_BY_SLUG, PUBLIC_EMOJI_IDS, PUBLIC_PACKS, seedCatalog } from './seed'

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

const PUBLIC_SLUGS = PUBLIC_PACKS.map((p) => p.slug).sort()

/** Expected order for the deterministic sorts, computed from the cards themselves. */
const EXPECTED: Record<Exclude<PackSort, 'random'>, (a: PackCard, b: PackCard) => number> = {
  new: (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id,
  hot: (a, b) => b.downloads - a.downloads || b.id - a.id,
  fav: (a, b) => b.favorites - a.favorites || b.id - a.id,
}

describe('listPacks pagination', () => {
  for (const sort of ['new', 'hot', 'fav'] as const) {
    for (const limit of [1, 3, 4, 24]) {
      test(`${sort}, limit ${limit}: every published pack exactly once, in order`, async () => {
        const { items, pages } = await allPages((cursor) => listPacks({ sort, cursor, limit }))
        const slugs = items.map((p) => p.slug)
        expect(new Set(slugs).size).toBe(slugs.length)
        expect([...slugs].sort()).toEqual(PUBLIC_SLUGS)
        expect(items).toEqual([...items].sort(EXPECTED[sort]))
        // limit + 1 look-ahead: no trailing empty page
        expect(pages.length).toBe(Math.ceil(PUBLIC_SLUGS.length / limit))
        for (const p of pages) expect(p.items.length).toBeLessThanOrEqual(limit)
        expect(pages.every((p) => p.seed === null)).toBe(true)
      })
    }
  }

  test('ties are broken by id (equal downloads, favorites and published_at)', async () => {
    const hot = (await listPacks({ sort: 'hot' })).items.map((p) => p.slug)
    // P2 and P3 both have 3000 downloads; P3 has the larger id
    expect(hot.indexOf('xin-01')).toBe(hot.indexOf('aimisi-02') - 1)
    const fav = (await listPacks({ sort: 'fav' })).items.map((p) => p.slug)
    expect(fav.slice(0, 3)).toEqual(['multi-01', 'aimisi-02', 'aimisi-01'])
    const fresh = (await listPacks({ sort: 'new' })).items.map((p) => p.slug)
    expect(fresh.indexOf('changli-01')).toBe(fresh.indexOf('xin-01') - 1)
    // P8 has no published_at: ordered by its created_at
    expect(fresh.indexOf('chun-01')).toBe(1)
  })

  test('random: a seed gives one stable order; pages never repeat; the cursor carries the seed', async () => {
    const a = await allPages((cursor) => listPacks({ sort: 'random', seed: 'abc123', cursor, limit: 3 }))
    const b = await allPages((cursor) => listPacks({ sort: 'random', seed: 'abc123', cursor, limit: 4 }))
    const slugsA = a.items.map((p) => p.slug)
    expect(new Set(slugsA).size).toBe(slugsA.length)
    expect([...slugsA].sort()).toEqual(PUBLIC_SLUGS)
    expect(b.items.map((p) => p.slug)).toEqual(slugsA)
    expect(a.pages.every((p) => p.seed === 'abc123')).toBe(true)

    // no seed: one is chosen and reported, and it sticks across pages
    const c = await allPages((cursor) => listPacks({ sort: 'random', cursor, limit: 3 }))
    const seed = c.pages[0]!.seed!
    expect(seed).toMatch(/^[0-9a-z]{1,16}$/)
    expect(c.pages.every((p) => p.seed === seed)).toBe(true)
    expect([...c.items.map((p) => p.slug)].sort()).toEqual(PUBLIC_SLUGS)

    const orders = new Set<string>()
    for (const s of ['s1', 's2', 's3', 's4', 's5']) orders.add((await listPacks({ sort: 'random', seed: s })).items.map((p) => p.slug).join())
    expect(orders.size).toBeGreaterThan(1)
  })

  test('malformed, foreign or tampered cursors are input errors', async () => {
    await expect(listPacks({ cursor: 'garbage!' })).rejects.toBeInstanceOf(CatalogInputError)
    await expect(listPacks({ cursor: 'Zm9v' })).rejects.toBeInstanceOf(CatalogInputError)
    const hot = (await listPacks({ sort: 'hot', limit: 2 })).nextCursor!
    await expect(listPacks({ sort: 'new', cursor: hot })).rejects.toBeInstanceOf(CatalogInputError)
    await expect(getGallery({ cursor: hot })).rejects.toBeInstanceOf(CatalogInputError)
    const tampered = encodeCursor({ scope: 'packs:hot', keys: ["1'; drop table packs; --", '1'] })
    await expect(listPacks({ sort: 'hot', cursor: tampered })).rejects.toBeInstanceOf(CatalogInputError)
    const badTime = encodeCursor({ scope: 'packs:new', keys: ['yesterday', '1'] })
    await expect(listPacks({ sort: 'new', cursor: badTime })).rejects.toBeInstanceOf(CatalogInputError)
    await expect(listPacks({ limit: 0 })).rejects.toThrow()
    await expect(listPacks({ limit: 61 })).rejects.toThrow()
  })
})

describe('listPacks filters', () => {
  const slugsOf = async (input: Parameters<typeof listPacks>[0]) =>
    (await allPages((cursor) => listPacks({ ...input, cursor, limit: 2 }))).items.map((p) => p.slug).sort()
  const expectSlugs = (pred: (p: (typeof PUBLIC_PACKS)[number]) => boolean) => PUBLIC_PACKS.filter(pred).map((p) => p.slug).sort()

  test('character (pack-level)', async () => {
    expect(await slugsOf({ character: 'aimisi' })).toEqual(['aimisi-01', 'aimisi-02', 'multi-01'])
    expect(await slugsOf({ character: 'yangyang' })).toEqual(['yangyang-01'])
    expect(await slugsOf({ character: 'shouanren' })).toEqual([])
    expect(await slugsOf({ character: 'nobody' })).toEqual([])
  })

  test('artist (either role)', async () => {
    expect(await slugsOf({ artist: 'maowushi' })).toEqual(['aimisi-01', 'aimisi-02'])
    expect(await slugsOf({ artist: '爱秧斯坦' })).toEqual(['feibi-01', 'yangyang-01'])
    expect(await slugsOf({ artist: 'kuroba' })).toEqual(['feibi-01'])
    expect(await slugsOf({ artist: 'ghost' })).toEqual([])
  })

  test('kind, source, group, tag, combined', async () => {
    expect(await slugsOf({ kind: 'static' })).toEqual(expectSlugs((p) => p.kind === 'static'))
    expect(await slugsOf({ kind: 'mixed' })).toEqual(['xinyuehu-01'])
    expect(await slugsOf({ source: 'official' })).toEqual(['official-01'])
    expect(await slugsOf({ source: 'community' })).toEqual(expectSlugs((p) => p.source === 'community'))
    expect(await slugsOf({ group: 'zhanzhang-tuijian' })).toEqual(['aimisi-01'])
    expect(await slugsOf({ tag: 'group:zhanzhang-tuijian' })).toEqual(['aimisi-01'])
    expect(await slugsOf({ tag: 'project:solar5' })).toEqual(['yangyang-01'])
    expect(await slugsOf({ tag: 'tool:ps' })).toEqual(['feibi-01'])
    expect(await slugsOf({ tag: 'custom:draft-only' })).toEqual([])
    expect(await slugsOf({ character: 'aimisi', kind: 'static' })).toEqual(['aimisi-02'])
    expect(await slugsOf({ character: 'aimisi', artist: 'maowushi', sort: 'random', seed: 'x' })).toEqual(['aimisi-01', 'aimisi-02'])
    await expect(listPacks({ tag: 'nodimension' })).rejects.toThrow()
  })
})

describe('emoji streams', () => {
  test('gallery new: every published emoji exactly once, newest packs first, pack order inside', async () => {
    for (const limit of [1, 7, 120]) {
      const { items } = await allPages((cursor) => getGallery({ sort: 'new', cursor, limit }))
      const ids = items.map((e) => e.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(new Set(ids)).toEqual(PUBLIC_EMOJI_IDS)
    }
    const { items } = await allPages((cursor) => getGallery({ cursor, limit: 10 }))
    const packOrder = (await listPacks({ sort: 'new' })).items.map((p) => p.slug)
    const seenPacks = items.map((e) => e.pack.slug).filter((s, i, a) => a.indexOf(s) === i)
    expect(seenPacks).toEqual(packOrder)
    // feibi-01: equal sort_order, so created_at decides (ids run the other way)
    const feibi = items.filter((e) => e.pack.slug === 'feibi-01').map((e) => e.id)
    expect(feibi).toEqual([...PACK_BY_SLUG['feibi-01']!.emojis].reverse().map((e) => e.id))
  })

  test('gallery random: seeded, complete, repeatable', async () => {
    const a = await allPages((cursor) => getGallery({ sort: 'random', seed: 'tide', cursor, limit: 8 }))
    const b = await allPages((cursor) => getGallery({ sort: 'random', seed: 'tide', cursor, limit: 13 }))
    const ids = a.items.map((e) => e.id)
    expect(new Set(ids)).toEqual(PUBLIC_EMOJI_IDS)
    expect(ids.length).toBe(PUBLIC_EMOJI_IDS.size)
    expect(b.items.map((e) => e.id)).toEqual(ids)
    expect(a.pages.every((p) => p.seed === 'tide')).toBe(true)
  })

  test('gallery filters: character (emoji-level) and type', async () => {
    const feibi = (await allPages((cursor) => getGallery({ character: 'feibi', cursor, limit: 4 }))).items
    expect(feibi.length).toBe(6 + 3)
    expect(new Set(feibi.map((e) => e.pack.slug))).toEqual(new Set(['feibi-01', 'multi-01']))
    const animated = (await allPages((cursor) => getGallery({ type: 'animated', cursor, limit: 50 }))).items
    const statics = (await allPages((cursor) => getGallery({ type: 'static', cursor, limit: 50 }))).items
    expect(animated.length + statics.length).toBe(PUBLIC_EMOJI_IDS.size)
    expect(animated.every((e) => e.frames > 1 && e.preview !== null)).toBe(true)
    expect(statics.every((e) => e.frames === 1 && e.preview === null)).toBe(true)
  })

  test('character 「全部表情」 tab paginates the same way', async () => {
    const { items } = await allPages(async (cursor) => {
      const d = await getCharacterDetail({ slug: 'aimisi', tab: 'emojis', cursor, limit: 5 })
      if (d.kind !== 'character' || d.tab !== 'emojis') throw new Error('expected the emojis tab')
      return d.page
    })
    expect(items.length).toBe(17)
    expect(new Set(items.map((e) => e.id)).size).toBe(17)
    const packsTab = await getCharacterDetail({ slug: 'aimisi', tab: 'packs', limit: 2 })
    if (packsTab.kind !== 'character' || packsTab.tab !== 'packs') throw new Error('expected the packs tab')
    expect(packsTab.page.items.length).toBe(2)
    const rest = await getCharacterDetail({ slug: 'aimisi', tab: 'packs', limit: 2, cursor: packsTab.page.nextCursor! })
    if (rest.kind !== 'character' || rest.tab !== 'packs') throw new Error('expected the packs tab')
    expect(rest.page.items.map((p) => p.slug)).toEqual(['aimisi-01'])
    expect(rest.page.nextCursor).toBeNull()
  })
})
