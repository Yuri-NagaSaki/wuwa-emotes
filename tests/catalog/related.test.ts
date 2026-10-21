import '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { DATABASE_URL, withClient } from '../integration/setup'
import { getPackDetail } from '#/server/catalog/pack'
import { listPacks } from '#/server/catalog/packs'
import { RELATED_LIMIT, relatedPacks, relatedPacksBySlug } from '#/server/catalog/related'
import type { PackDetail } from '#/server/catalog/types'
import { HIDDEN_PACKS, PUBLIC_PACKS, seedCatalog } from './seed'

// 相关推荐 (catalog/related.ts) over the seeded catalog: 10 public packs, plus a draft, a hidden and a
// not-ready pack that are popular enough to top any list if they leaked.

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

async function pack(slug: string): Promise<PackDetail> {
  const r = await getPackDetail(slug)
  if (r.kind !== 'pack') throw new Error(`expected pack ${slug}, got ${r.kind}`)
  return r.pack
}

const slugs = (cards: { slug: string }[]) => cards.map((c) => c.slug)

describe('relatedPacks', () => {
  test('never the pack itself, never a draft, hidden or not-ready pack', async () => {
    const hidden = new Set(HIDDEN_PACKS.map((p) => p.slug))
    for (const fx of PUBLIC_PACKS) {
      const list = slugs(await relatedPacksBySlug(fx.slug))
      expect(list).not.toContain(fx.slug)
      expect(list.filter((s) => hidden.has(s))).toEqual([])
      expect(new Set(list).size).toBe(list.length)
      // every other public pack fits under the limit, so all of them are there
      expect(list.length).toBe(Math.min(RELATED_LIMIT, PUBLIC_PACKS.length - 1))
    }
    // aimisi-01 shares its group tag with hidden-01 (88,888 downloads), which still never shows
    expect(slugs(await relatedPacksBySlug('aimisi-01'))).not.toContain('hidden-01')
  })

  test('shared artist (3) and character (2) rank first; the rest by downloads, newest, id', async () => {
    // aimisi-02: same artist + same character = 5; multi-01: same character = 2; then the others by
    // downloads; xin-01 and aimisi-02 tie at 3,000 elsewhere, chun-01 (no published_at, created 09-25)
    // is newer than official-01 (09-22) at 0 downloads
    expect(slugs(await relatedPacksBySlug('aimisi-01'))).toEqual([
      'aimisi-02',
      'multi-01',
      'xin-01',
      'feibi-01',
      'xinyuehu-01',
      'changli-01',
      'yangyang-01',
      'chun-01',
      'official-01',
    ])
  })

  test('a shared artist outranks a shared character; commissioners do not count', async () => {
    // feibi-01: yangyang-01 shares the artist 爱秧斯坦 (300 downloads), multi-01 the character 菲比
    // (2,500 downloads); kuroba is feibi-01's commissioner and on no other pack
    const list = slugs(await relatedPacksBySlug('feibi-01'))
    expect(list.slice(0, 2)).toEqual(['yangyang-01', 'multi-01'])
    // the most downloaded pack (aimisi-01, 5,000) shares nothing and comes after both
    expect(list.slice(2)).toEqual(['aimisi-01', 'xin-01', 'aimisi-02', 'xinyuehu-01', 'changli-01', 'chun-01', 'official-01'])
  })

  test('with nothing shared, the list is the most downloaded other packs', async () => {
    // changli-01 shares no artist, character or tag: pure fill-up. Ties: xin-01 (09-10) is newer than
    // aimisi-02 (09-05); chun-01 newer than official-01
    expect(slugs(await relatedPacksBySlug('changli-01'))).toEqual([
      'aimisi-01',
      'xin-01',
      'aimisi-02',
      'multi-01',
      'feibi-01',
      'xinyuehu-01',
      'yangyang-01',
      'chun-01',
      'official-01',
    ])
  })

  test('group and project tags count 1 each; other dimensions do not count', async () => {
    await withClient(DATABASE_URL, async (c) => {
      const add = `insert into pack_tags (pack_id, tag_id)
        select p.id, t.id from packs p, tags t where p.slug = $1 and t.dimension = $2 and t.slug = $3`
      await c.query(add, ['xinyuehu-01', 'group', 'zhanzhang-tuijian'])
      await c.query(add, ['changli-01', 'project', 'solar5'])
      await c.query(add, ['changli-01', 'tool', 'ps'])
    })
    try {
      // aimisi-01 and xinyuehu-01 now share 站长推荐 (group): 1, above the 3,000-download packs
      expect(slugs(await relatedPacksBySlug('aimisi-01')).slice(0, 4)).toEqual(['aimisi-02', 'multi-01', 'xinyuehu-01', 'xin-01'])
      // yangyang-01 and changli-01 share a project tag: 1, so changli-01 (450 downloads) follows
      // feibi-01 (the shared artist, 3) ahead of every pack that shares nothing
      const yang = slugs(await relatedPacksBySlug('yangyang-01'))
      expect(yang.slice(0, 2)).toEqual(['feibi-01', 'changli-01'])
      // feibi-01 and changli-01 share only a tool tag: no score, changli-01 stays with the fill-up
      const feibi = slugs(await relatedPacksBySlug('feibi-01'))
      expect(feibi.indexOf('changli-01')).toBeGreaterThan(feibi.indexOf('aimisi-01'))
    } finally {
      await withClient(DATABASE_URL, async (c) => {
        await c.query(`delete from pack_tags pt using packs p, tags t
          where pt.pack_id = p.id and pt.tag_id = t.id
            and ((p.slug = 'xinyuehu-01' and t.slug = 'zhanzhang-tuijian') or (p.slug = 'changli-01' and t.slug in ('solar5', 'ps')))`)
      })
    }
  })

  test('limit is respected and keeps the order', async () => {
    const id = (await pack('aimisi-01')).id
    const full = slugs(await relatedPacks(id))
    expect(slugs(await relatedPacks(id, 3))).toEqual(full.slice(0, 3))
    expect(slugs(await relatedPacks(id, 1))).toEqual(full.slice(0, 1))
    expect((await relatedPacks(id, 1000)).length).toBe(PUBLIC_PACKS.length - 1)
  })

  test('deterministic: the same list by id, by slug, in the pack detail, on every call', async () => {
    for (const slug of ['aimisi-01', 'multi-01', 'yangyang-01']) {
      const d = await pack(slug)
      const byId = await relatedPacks(d.id)
      expect(await relatedPacks(d.id)).toEqual(byId)
      expect(await relatedPacksBySlug(slug)).toEqual(byId)
      expect(d.related).toEqual(byId)
    }
  })

  test('cards are the /packs cards without minis; an unknown slug has none', async () => {
    const hot = new Map((await listPacks({ sort: 'hot', limit: 50 })).items.map((c) => [c.slug, c]))
    const list = await relatedPacksBySlug('multi-01')
    expect(list.length).toBeGreaterThan(0)
    for (const card of list) {
      expect(card.minis).toEqual([])
      expect(card.cover).not.toBeNull()
      expect(card).toEqual({ ...hot.get(card.slug)!, minis: [] })
    }
    expect(await relatedPacksBySlug('nope')).toEqual([])
    expect(await relatedPacks(-1)).toEqual([])
  })
})
