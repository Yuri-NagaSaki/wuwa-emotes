import '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { getArtistDetail, listArtists } from '#/server/catalog/artists'
import { getCharacterDetail, listCharacters } from '#/server/catalog/characters'
import { getExplore, getFacets } from '#/server/catalog/explore'
import { getHome } from '#/server/catalog/home'
import { getEmojiPermalink, getPackDetail } from '#/server/catalog/pack'
import { listPacks } from '#/server/catalog/packs'
import { searchCatalog, suggestCatalog } from '#/server/catalog/search'
import { getGallery } from '#/server/catalog/stream'
import type { PackSort } from '#/server/catalog/types'
import { allPages, EMOJI_ID_GLOBAL } from './helpers'
import { resolveLegacyPath } from '#/server/catalog/legacy'
import { CHARACTERS, FORBIDDEN_EMOJI_IDS, FORBIDDEN_STRINGS, isPublicEmoji, PACK_BY_SLUG, PACKS, PUBLIC_EMOJI_IDS, PUBLIC_PACKS, seedCatalog } from './seed'

// Drafts, hidden packs, pending/hidden emojis, emojis without derivatives, packs with no public emoji
// and everything only they use never leave the module.

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

const SORTS: PackSort[] = ['hot', 'new', 'fav', 'random']

/** Every public output the module can produce for the fixture. */
async function everything(): Promise<unknown[]> {
  const out: unknown[] = []
  out.push(await getHome())
  for (const sort of SORTS) out.push((await allPages((cursor) => listPacks({ sort, cursor, limit: 4 }))).items)
  for (const p of PACKS) out.push(await getPackDetail(p.slug))
  for (const sort of ['count', 'recent', 'pinyin'] as const) out.push(await listCharacters({ sort }))
  for (const ch of CHARACTERS) {
    out.push(await getCharacterDetail({ slug: ch.slug }))
    const emojiTab = await allPages<unknown>(async (cursor) => {
      const d = await getCharacterDetail({ slug: ch.slug, tab: 'emojis', cursor, limit: 5 })
      return d.kind === 'character' ? d.page : { items: [], nextCursor: null, seed: null }
    })
    out.push(emojiTab.items)
  }
  out.push(await listArtists())
  for (const slug of ['maowushi', '爱秧斯坦', 'kuroba', 'ghost', 'pending-artist']) out.push(await getArtistDetail({ slug }))
  for (const sort of ['new', 'random'] as const) out.push((await allPages((cursor) => getGallery({ sort, cursor, limit: 9 }))).items)
  for (let i = 0; i < 25; i++) out.push(await getExplore())
  out.push(await getFacets())
  for (const q of ['守岸人', '守岸', '草稿', '隐藏', '秧秧', '秧', '幽灵', 'Ghost', 'GhostArtist', '草稿专用', '爱弥斯', '心', 'draft', '合集', 'a', '表情', '白芷', '白芷医生', '处理中', '待处理', 'Pending', '未就绪', 'notready']) {
    // the result echoes the query itself; everything else must be clean
    const { q: echoed, ...result } = await searchCatalog({ q, limit: 60 })
    expect(echoed).toBe(q)
    out.push(result)
    out.push(await suggestCatalog({ q, limit: 20 }))
  }
  return out
}

describe('visibility', () => {
  test('no draft/hidden pack, unpublished emoji, or entity used only by them appears anywhere', async () => {
    const json = JSON.stringify(await everything())
    for (const id of FORBIDDEN_EMOJI_IDS) expect(json).not.toContain(id)
    for (const s of FORBIDDEN_STRINGS) expect(json).not.toContain(s)
    // every emoji id that does appear is a published emoji of a published pack
    const seen = new Set(json.match(EMOJI_ID_GLOBAL))
    expect(seen.size).toBeGreaterThan(0)
    for (const id of seen) expect(PUBLIC_EMOJI_IDS.has(id)).toBe(true)
  }, 60_000)

  test('unpublished packs are missing, not redirected', async () => {
    expect(await getPackDetail('draft-01')).toEqual({ kind: 'missing' })
    expect(await getPackDetail('hidden-01')).toEqual({ kind: 'missing' })
    expect(await getPackDetail('to-draft')).toEqual({ kind: 'missing' })
    expect(await getPackDetail('notready-01')).toEqual({ kind: 'missing' })
    expect(await getPackDetail('to-notready')).toEqual({ kind: 'missing' })
  })

  test('permalinks of unpublished emojis resolve to nothing', async () => {
    const p1 = PACK_BY_SLUG['aimisi-01']!
    expect(await getEmojiPermalink(p1.emojis[6]!.id)).toBeNull() // pending in a published pack
    expect(await getEmojiPermalink(p1.emojis[7]!.id)).toBeNull() // hidden in a published pack
    expect(await getEmojiPermalink(PACK_BY_SLUG['draft-01']!.emojis[0]!.id)).toBeNull() // published, draft pack
    expect(await getEmojiPermalink(PACK_BY_SLUG['hidden-01']!.emojis[0]!.id)).toBeNull() // published, hidden pack
  })

  test('characters and artists without published content are missing', async () => {
    expect(await getCharacterDetail({ slug: 'shouanren' })).toEqual({ kind: 'missing' })
    expect(await getArtistDetail({ slug: 'ghost' })).toEqual({ kind: 'missing' })
    expect((await listCharacters()).map((c) => c.slug)).not.toContain('shouanren')
    expect((await listArtists()).map((a) => a.slug)).not.toContain('ghost')
  })

  test('counts are live over published rows (denormalized columns ignored)', async () => {
    const home = await getHome()
    const published = PUBLIC_PACKS
    expect(home.stats.packs).toBe(published.length)
    expect(home.stats.emojis).toBe(PUBLIC_EMOJI_IDS.size)
    expect(home.stats.downloads).toBe(published.reduce((s, p) => s + p.downloads, 0))
    // 守岸人 only has a draft pack, 白芷 only a pack without derivatives
    expect(home.stats.characters).toBe(CHARACTERS.length - 2)
    // P12 published today (6 emojis) + one emoji ingested today into P1
    expect(home.stats.todayEmojis).toBe(7)

    const cards = (await allPages((cursor) => listPacks({ cursor }))).items
    for (const card of cards) {
      const fx = PACK_BY_SLUG[card.slug]!
      expect(card.count).toBe(fx.emojis.filter(isPublicEmoji).length)
    }
    const aimisi = (await listCharacters()).find((c) => c.slug === 'aimisi')!
    expect(aimisi.packCount).toBe(3)
    expect(aimisi.emojiCount).toBe(7 + 7 + 3)
  })

  test('a cover or avatar pointing at an unpublished emoji falls back to a published one', async () => {
    const p1 = PACK_BY_SLUG['aimisi-01']!
    const card = (await listPacks({ sort: 'hot', limit: 1 })).items[0]!
    expect(card.slug).toBe('aimisi-01')
    expect(card.cover!.id).toBe(p1.emojis[0]!.id)

    const detail = await getPackDetail('aimisi-01')
    expect(detail.kind === 'pack' && detail.pack.cover!.id).toBe(p1.emojis[0]!.id)

    const chars = await listCharacters()
    const yang = chars.find((c) => c.slug === 'yangyang')!
    expect(PACK_BY_SLUG['yangyang-01']!.emojis.map((e) => e.id)).toContain(yang.avatar!.id)
    const changli = chars.find((c) => c.slug === 'changli')!
    expect(changli.avatar!.id).toBe(PACK_BY_SLUG['changli-01']!.emojis[2]!.id)
  })

  test('home: featured skips unpublished and draft-only collections; pinned ignores unpublished packs', async () => {
    const home = await getHome()
    expect(home.featuredCollection).toEqual({ slug: 'featured', title: '站长精选', description: null })
    expect(home.featured.map((p) => p.slug)).toEqual(['feibi-01', 'aimisi-01'])
    expect(home.pinned.map((p) => p.slug)).toEqual(['aimisi-01'])
    expect(home.latest[0]!.slug).toBe('yangyang-01')
    expect(home.latest.length).toBe(PUBLIC_PACKS.length)
    expect(home.characters[0]!.slug).toBe('aimisi')
    expect(home.characters.every((c) => c.avatar)).toBe(true)
    // 官方表情: the official pack first, then the most downloaded community packs
    expect(home.official[0]!.slug).toBe('official-01')
    expect(home.official.length).toBe(Math.min(4, PUBLIC_PACKS.length))
    expect(home.official.slice(1).every((p) => p.sourceKind === 'community')).toBe(true)
  })
})

describe('derived readiness (only emojis with web derivatives are public)', () => {
  test('a published pack without ready emojis is hidden everywhere, including its only entities', async () => {
    expect(PUBLIC_PACKS.map((p) => p.slug)).not.toContain('notready-01')
    expect(await getCharacterDetail({ slug: 'baizhi' })).toEqual({ kind: 'missing' })
    expect(await getCharacterDetail({ slug: 'baizhi-old' })).toEqual({ kind: 'missing' })
    expect(await getArtistDetail({ slug: 'pending-artist' })).toEqual({ kind: 'missing' })
    expect((await listPacks({ tag: 'custom:notready-only' })).items).toEqual([])
    expect((await listPacks({ character: 'baizhi' })).items).toEqual([])
    expect((await getFacets()).tags.custom).toEqual([])
    // legacy paths never lead to it
    expect(await resolveLegacyPath('/packs/to-notready')).toBeNull()
    expect(await resolveLegacyPath('/archives/notready-01')).toBeNull()
    expect(await resolveLegacyPath('/tags/baizhi')).toBeNull()
    for (const e of PACK_BY_SLUG['notready-01']!.emojis) expect(await getEmojiPermalink(e.id)).toBeNull()
    const home = await getHome()
    expect(home.pinned.map((p) => p.slug)).toEqual(['aimisi-01'])
    expect(home.latest[0]!.slug).toBe('yangyang-01')
  })

  test('a not-ready emoji inside a public pack is skipped: list, count, permalink index', async () => {
    const fx = PACK_BY_SLUG['xin-01']!
    const notReady = fx.emojis[1]!
    expect(notReady.ready).toBe(false)
    const d = await getPackDetail('xin-01')
    if (d.kind !== 'pack') throw new Error('expected xin-01')
    expect(d.pack.emojis.map((e) => e.id)).toEqual(fx.emojis.filter(isPublicEmoji).map((e) => e.id))
    expect(d.pack.count).toBe(fx.emojis.length - 1)
    expect(await getEmojiPermalink(notReady.id)).toBeNull()
    expect(await getEmojiPermalink(fx.emojis[2]!.id)).toEqual({ emojiId: fx.emojis[2]!.id, packSlug: 'xin-01', index: 1 })
    expect(await resolveLegacyPath(`/e/${notReady.id}`)).toBeNull()
  })

  test('a cover or avatar pointing at a not-ready emoji falls back to a public one', async () => {
    const fx = PACK_BY_SLUG['xinyuehu-01']!
    const card = (await listPacks({ kind: 'mixed' })).items[0]!
    expect(card.slug).toBe('xinyuehu-01')
    expect(card.cover!.id).toBe(fx.emojis[1]!.id)
    expect([card.cover, ...card.minis].every((img) => PUBLIC_EMOJI_IDS.has(img!.id))).toBe(true)
    const d = await getPackDetail('xinyuehu-01')
    expect(d.kind === 'pack' && d.pack.cover!.id).toBe(fx.emojis[1]!.id)
    // animated filter on the character's emoji tab: the not-ready animated emoji is not counted
    const typed = await getCharacterDetail({ slug: 'xinyuehu', tab: 'emojis', type: 'animated' })
    expect(typed.kind === 'character' && typed.page.items.map((e) => e.id)).toEqual(fx.emojis.slice(1, 4).map((e) => e.id))
    const xin = (await listCharacters()).find((c) => c.slug === 'xin')!
    expect(xin.avatar!.id).not.toBe(PACK_BY_SLUG['xin-01']!.emojis[1]!.id)
    expect(PUBLIC_EMOJI_IDS.has(xin.avatar!.id)).toBe(true)
    expect(xin.emojiCount).toBe(PACK_BY_SLUG['xin-01']!.emojis.filter(isPublicEmoji).length)
  })
})
