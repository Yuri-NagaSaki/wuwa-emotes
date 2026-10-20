import '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { getArtistDetail, listArtists } from '#/server/catalog/artists'
import { clearCatalogCache } from '#/server/catalog/cache'
import { getCharacterDetail, listCharacters } from '#/server/catalog/characters'
import { getExplore, getFacets } from '#/server/catalog/explore'
import { getHome } from '#/server/catalog/home'
import { getEmojiPermalink, getPackDetail } from '#/server/catalog/pack'
import { listPacks } from '#/server/catalog/packs'
import { getGallery } from '#/server/catalog/stream'
import type { PackDetail } from '#/server/catalog/types'
import { allPages, collectImages } from './helpers'
import { PACK_BY_SLUG, PACKS, PUBLIC_EMOJI_IDS, PUBLIC_PACKS, seedCatalog } from './seed'

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

async function pack(slug: string): Promise<PackDetail> {
  const r = await getPackDetail(slug)
  if (r.kind !== 'pack') throw new Error(`expected pack ${slug}, got ${r.kind}`)
  return r.pack
}

describe('packDetail', () => {
  test('published emojis in pack order (sort_order, then created_at, then id)', async () => {
    const p1 = await pack('aimisi-01')
    const fx = PACK_BY_SLUG['aimisi-01']!
    expect(p1.emojis.map((e) => e.id)).toEqual([0, 1, 2, 3, 4, 5, 8].map((i) => fx.emojis[i]!.id))
    expect(p1.emojis.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(p1.count).toBe(7)
    const feibi = await pack('feibi-01')
    expect(feibi.emojis.map((e) => e.id)).toEqual([...PACK_BY_SLUG['feibi-01']!.emojis].reverse().map((e) => e.id))
  })

  test('emoji fields: format, bytes, frames, dimensions (unknown → 300×300)', async () => {
    const p2 = await pack('aimisi-02')
    expect(p2.emojis[0]).toMatchObject({ width: 240, height: 180, frames: 1, format: 'png', preview: null })
    expect(p2.emojis[0]!.bytes).toBe(PACK_BY_SLUG['aimisi-02']!.emojis[0]!.bytes)
    const xin = await pack('xin-01')
    expect(xin.emojis[0]).toMatchObject({ width: 300, height: 300 })
    const p1 = await pack('aimisi-01')
    expect(p1.emojis[0]).toMatchObject({ frames: 12, format: 'gif' })
    expect(p1.emojis[0]!.characters).toEqual([{ slug: 'aimisi', name: '爱弥斯', color: 'pink' }])
  })

  test('credits split: artists vs commissioners, free-text credits, license, source', async () => {
    const p = await pack('feibi-01')
    expect(p.artists).toEqual([{ slug: '爱秧斯坦', name: '爱秧斯坦' }])
    expect(p.commissioners).toEqual([{ slug: 'kuroba', name: '黑羽' }])
    expect(p.commissionerText).toBe('黑羽')
    expect(p.creditsText).toBe('画师：爱秧斯坦；约稿：黑羽')
    expect(p.sourceUrl).toBe('https://example.com/feibi')
    expect(p.license).toBe('CC BY-NC-SA 4.0')
    expect(p.downloadable).toBe(true)
    expect(p.tags).toEqual({ group: [], tool: [{ dimension: 'tool', slug: 'ps', name: 'Photoshop' }], project: [], origin: [], custom: [] })
    const official = await pack('official-01')
    expect(official).toMatchObject({ sourceKind: 'official', downloadable: false, artists: [], commissioners: [], commissionerText: null })
  })

  test('characters in characters.sort order; accent from the first one', async () => {
    const m = await pack('multi-01')
    expect(m.characters.map((c) => c.slug)).toEqual(['aimisi', 'feibi', 'jinxi'])
    expect(m.accent).toBe('pink')
    expect(m.emojis.map((e) => e.characters[0]!.slug)).toEqual(['aimisi', 'aimisi', 'aimisi', 'feibi', 'feibi', 'feibi', 'jinxi', 'jinxi', 'jinxi'])
    const card = (await listPacks({ character: 'jinxi', kind: 'animated' })).items[0]!
    expect(card.slug).toBe('multi-01')
    expect(card.accent).toBe('pink')
  })

  test('prev/next follow publication order and skip unpublished packs', async () => {
    const order = ['aimisi-01', 'aimisi-02', 'xin-01', 'changli-01', 'xinyuehu-01', 'feibi-01', 'multi-01', 'official-01', 'chun-01', 'yangyang-01']
    for (const [i, slug] of order.entries()) {
      const p = await pack(slug)
      expect(p.prev?.slug ?? null).toBe(order[i - 1] ?? null)
      expect(p.next?.slug ?? null).toBe(order[i + 1] ?? null)
    }
    const p2 = await pack('aimisi-02')
    expect(p2.prev).toMatchObject({ slug: 'aimisi-01', title: '爱弥斯动态表情包（板牌）' })
    expect(p2.prev!.cover!.id).toBe(PACK_BY_SLUG['aimisi-01']!.emojis[0]!.id)
  })

  test('old slugs redirect; unknown slugs are missing', async () => {
    expect(await getPackDetail('yangyang-old')).toEqual({ kind: 'redirect', redirectTo: '/packs/yangyang-01' })
    expect(await getPackDetail('yangyang-legacy-slug')).toEqual({ kind: 'redirect', redirectTo: '/packs/yangyang-01' })
    expect(await getPackDetail('nope')).toEqual({ kind: 'missing' })
  })
})

describe('emojiPermalink', () => {
  test('pack slug + index into PackDetail.emojis', async () => {
    const fx = PACK_BY_SLUG['aimisi-01']!
    expect(await getEmojiPermalink(fx.emojis[8]!.id)).toEqual({ emojiId: fx.emojis[8]!.id, packSlug: 'aimisi-01', index: 6 })
    expect(await getEmojiPermalink(fx.emojis[0]!.id)).toEqual({ emojiId: fx.emojis[0]!.id, packSlug: 'aimisi-01', index: 0 })
    const feibi = PACK_BY_SLUG['feibi-01']!
    expect((await getEmojiPermalink(feibi.emojis[0]!.id))!.index).toBe(5)
    for (const p of PUBLIC_PACKS) {
      const detail = await pack(p.slug)
      const e = detail.emojis[detail.emojis.length - 1]!
      expect(await getEmojiPermalink(e.id)).toEqual({ emojiId: e.id, packSlug: p.slug, index: detail.emojis.length - 1 })
    }
  })

  test('invalid or unknown ids', async () => {
    expect(await getEmojiPermalink('xyz')).toBeNull()
    expect(await getEmojiPermalink('r-ffffffffffffffffffff')).toBeNull()
  })
})

describe('image URLs', () => {
  test('poster p240, preview a160 only when animated, full; storage pack key and rev', async () => {
    const outputs: unknown[] = [await getHome(), await listCharacters(), await getExplore(), await getFacets()]
    for (const p of PUBLIC_PACKS) outputs.push(await getPackDetail(p.slug))
    outputs.push((await allPages((cursor) => getGallery({ cursor, limit: 50 }))).items)
    outputs.push((await allPages((cursor) => listPacks({ cursor }))).items)
    const images = collectImages(outputs)
    expect(images.length).toBeGreaterThan(PUBLIC_EMOJI_IDS.size)

    const fxById = new Map(PACKS.flatMap((p) => p.emojis.map((e) => [e.id, e] as const)))
    const URL_RE = /^\/img\/v1\/(p240|a160|full)\/([a-z0-9-]+)\/(r-[0-9a-f]{20})\.r([1-9][0-9]*)\.webp$/
    for (const img of images) {
      const fx = fxById.get(img.id)!
      expect(PUBLIC_EMOJI_IDS.has(img.id)).toBe(true)
      for (const [field, variant] of [
        ['poster', 'p240'],
        ['full', 'full'],
      ] as const) {
        const m = URL_RE.exec(img[field])
        expect(m).not.toBeNull()
        expect(m!.slice(1)).toEqual([variant, fx.storageKey, img.id, String(fx.rev)])
      }
      if (fx.frames > 1) {
        expect(URL_RE.exec(img.preview!)!.slice(1)).toEqual(['a160', fx.storageKey, img.id, String(fx.rev)])
      } else {
        expect(img.preview).toBeNull()
      }
      expect(img.frames).toBe(fx.frames)
    }
    // the moved emoji keeps the key it was ingested under
    const moved = PACK_BY_SLUG['aimisi-02']!.emojis[3]!
    expect((await pack('aimisi-02')).emojis[3]!.poster).toBe(`/img/v1/p240/aimisi-01/${moved.id}.r2.webp`)
  })
})

describe('characters and artists', () => {
  test('list sorts and counts', async () => {
    const byCount = await listCharacters()
    expect(byCount[0]!.slug).toBe('aimisi')
    expect(byCount.map((c) => c.emojiCount)).toEqual([...byCount.map((c) => c.emojiCount)].sort((a, b) => b - a))
    expect((await listCharacters({ sort: 'recent' }))[0]!.slug).toBe('yangyang')
    const pinyin = (await listCharacters({ sort: 'pinyin' })).map((c) => c.slug)
    expect(pinyin).toEqual([...pinyin].sort())
    const feibi = byCount.find((c) => c.slug === 'feibi')!
    expect(feibi).toMatchObject({ packCount: 2, emojiCount: 6 + 3, color: 'blue' })
  })

  test('character detail: profile, aliases, artists, redirects', async () => {
    const d = await getCharacterDetail({ slug: 'aimisi' })
    if (d.kind !== 'character' || d.tab !== 'packs') throw new Error('expected character packs tab')
    expect(d.character).toMatchObject({ slug: 'aimisi', name: '爱弥斯', aliases: ['Aimisi'], packCount: 3 })
    expect(d.artists).toEqual([{ slug: 'maowushi', name: '猫屋敷梨梨', packCount: 2 }])
    expect(d.page.items.map((p) => p.slug)).toEqual(['multi-01', 'aimisi-02', 'aimisi-01'])
    expect(await getCharacterDetail({ slug: 'yangyang-legacy' })).toEqual({ kind: 'redirect', redirectTo: '/characters/yangyang' })
    expect(await getCharacterDetail({ slug: 'old-chun-2' })).toEqual({ kind: 'redirect', redirectTo: '/characters/chun' })
    expect(await getCharacterDetail({ slug: 'to-hidden' })).toEqual({ kind: 'missing' })
    const typed = await getCharacterDetail({ slug: 'xinyuehu', tab: 'emojis', type: 'animated' })
    expect(typed.kind === 'character' && typed.page.items.length).toBe(3)
  })

  test('artists: counts by role, safe links, aliases, Chinese slugs, redirects', async () => {
    const list = await listArtists()
    // most packs first (maowushi and 爱秧斯坦 tie on 2; the name order between them is collation-dependent)
    expect(list.map((a) => a.slug).slice(0, 2).sort()).toEqual(['maowushi', '爱秧斯坦'].sort())
    expect(list.map((a) => a.slug)[2]).toBe('kuroba')
    const mao = list.find((a) => a.slug === 'maowushi')!
    expect(mao).toMatchObject({ packCount: 2, drawnCount: 2, commissionedCount: 0, emojiCount: 14 })
    expect(mao.links).toEqual([{ label: 'B站', url: 'https://space.bilibili.com/1' }])
    expect(list[2]).toMatchObject({ slug: 'kuroba', packCount: 1, drawnCount: 0, commissionedCount: 1 })

    const d = await getArtistDetail({ slug: '爱秧斯坦' })
    if (d.kind !== 'artist') throw new Error('expected artist')
    expect(d.artist.aliases).toEqual(['AiEinstein'])
    expect(d.page.items.map((p) => p.slug)).toEqual(['yangyang-01', 'feibi-01'])
    expect(d.characters.map((c) => c.slug).sort()).toEqual(['feibi', 'yangyang'])
    expect(await getArtistDetail({ slug: 'maowushi-old' })).toEqual({ kind: 'redirect', redirectTo: '/artists/maowushi' })
    expect(await getArtistDetail({ slug: 'ghost-old' })).toEqual({ kind: 'missing' })
  })
})

describe('explore and facets', () => {
  test('random picks are public; today picks are stable for the day', async () => {
    const day = new Date('2026-10-20T04:00:00Z')
    const a = await getExplore(day)
    const b = await getExplore(day)
    expect(a.today.day).toBe('2026-10-20')
    expect(a.today.packs.length).toBe(3)
    expect(a.today.emojis.length).toBe(8)
    expect(b.today).toEqual(a.today)
    expect(new Set(a.today.packs.map((p) => p.slug)).size).toBe(3)
    // 23:30 UTC on the 19th is already the 20th in Shanghai
    expect((await getExplore(new Date('2026-10-19T23:30:00Z'))).today.day).toBe('2026-10-20')
    for (let i = 0; i < 10; i++) {
      const e = await getExplore()
      expect(PUBLIC_PACKS.map((p) => p.slug)).toContain(e.randomPack!.slug)
      expect(PUBLIC_EMOJI_IDS.has(e.randomEmoji!.id)).toBe(true)
    }
  })

  test('facets only count published packs', async () => {
    const f = await getFacets()
    expect(f.tags.group).toEqual([{ slug: 'zhanzhang-tuijian', name: '站长推荐', packCount: 1 }])
    expect(f.tags.custom).toEqual([])
    expect(f.tags.project).toEqual([{ slug: 'solar5', name: '企划/Solar5', packCount: 1 }])
    expect(f.kinds.reduce((s, k) => s + k.packCount, 0)).toBe(PUBLIC_PACKS.length)
    expect(f.sources).toEqual([
      { sourceKind: 'community', packCount: PUBLIC_PACKS.length - 1 },
      { sourceKind: 'official', packCount: 1 },
    ])
    expect(f.characters.find((c) => c.slug === 'aimisi')!.packCount).toBe(3)
  })
})

describe('cache', () => {
  test('home and lists are cached until cleared', async () => {
    clearCatalogCache()
    const a = await getHome()
    expect(await getHome()).toBe(a)
    expect(await listArtists()).toEqual(await listArtists())
    clearCatalogCache()
    const b = await getHome()
    expect(b).not.toBe(a)
    expect(b).toEqual(a)
  })
})
