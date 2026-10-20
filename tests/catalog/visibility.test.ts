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
import { CHARACTERS, FORBIDDEN_EMOJI_IDS, FORBIDDEN_STRINGS, PACK_BY_SLUG, PACKS, PUBLIC_EMOJI_IDS, PUBLIC_PACKS, seedCatalog } from './seed'

// Drafts, hidden packs, pending/hidden emojis and everything only they use never leave the module.

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
    out.push((await allPages(async (cursor) => {
      const d = await getCharacterDetail({ slug: ch.slug, tab: 'emojis', cursor, limit: 5 })
      return d.kind === 'character' ? d.page : { items: [], nextCursor: null, seed: null }
    })).items)
  }
  out.push(await listArtists())
  for (const slug of ['maowushi', '爱秧斯坦', 'kuroba', 'ghost']) out.push(await getArtistDetail({ slug }))
  for (const sort of ['new', 'random'] as const) out.push((await allPages((cursor) => getGallery({ sort, cursor, limit: 9 }))).items)
  for (let i = 0; i < 25; i++) out.push(await getExplore())
  out.push(await getFacets())
  for (const q of ['守岸人', '守岸', '草稿', '隐藏', '秧秧', '秧', '幽灵', 'Ghost', 'GhostArtist', '草稿专用', '爱弥斯', '心', 'draft', '合集', 'a', '表情']) {
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
    expect(home.stats.characters).toBe(CHARACTERS.length - 1)
    // P12 published today (6 emojis) + one emoji ingested today into P1
    expect(home.stats.todayEmojis).toBe(7)

    const cards = (await allPages((cursor) => listPacks({ cursor }))).items
    for (const card of cards) {
      const fx = PACK_BY_SLUG[card.slug]!
      expect(card.count).toBe(fx.emojis.filter((e) => e.status === 'published').length)
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
  })
})
