import '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { getBatchItems } from '#/server/catalog/batch'
import { getPackDetail } from '#/server/catalog/pack'
import { collectImages } from './helpers'
import { PACK_BY_SLUG, seedCatalog } from './seed'

// getBatchItems: what the 打包清单 tray and /batch show for the ids kept in the browser.

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

const P = (slug: string) => PACK_BY_SLUG[slug]!

describe('batch items', () => {
  test('public emojis in request order, with pack, size and position', async () => {
    const a = P('aimisi-01').emojis
    const official = P('official-01').emojis
    const ids = [official[2]!.id, a[3]!.id, a[0]!.id]
    const items = await getBatchItems({ ids })
    expect(items.map((i) => i.id)).toEqual(ids)
    expect(items[1]).toMatchObject({
      id: a[3]!.id,
      format: 'gif',
      bytes: a[3]!.bytes,
      index: 3,
      pack: { slug: 'aimisi-01', title: '爱弥斯动态表情包（板牌）', downloadable: true },
    })
    // preview-only packs are listed (the page explains why they cannot be packed)
    expect(items[0]!.pack).toEqual({ slug: 'official-01', title: '官方表情 第一弹', downloadable: false })
    // the same image URLs as the pack page
    const detail = await getPackDetail('aimisi-01')
    if (detail.kind !== 'pack') throw new Error('pack')
    const fromPage = detail.pack.emojis.find((e) => e.id === a[3]!.id)!
    expect(items[1]).toMatchObject({ poster: fromPage.poster, preview: fromPage.preview, width: fromPage.width, height: fromPage.height })
  })

  test('position counts only public emojis before it (as on the pack page)', async () => {
    // aimisi-01: 6 published, then pending, hidden, then one published created today (sort 99)
    const last = P('aimisi-01').emojis[8]!
    const [item] = await getBatchItems({ ids: [last.id] })
    expect(item!.index).toBe(6)
  })

  test('pending, hidden, not ready, hidden pack and unknown ids are left out; duplicates once', async () => {
    const a = P('aimisi-01').emojis
    const ids = [
      a[6]!.id, // pending
      a[7]!.id, // hidden
      P('notready-01').emojis[0]!.id, // derivatives missing
      P('hidden-01').emojis[0]!.id, // pack hidden
      P('draft-01').emojis[0]!.id, // draft pack
      `r-${'0'.repeat(20)}`,
      a[1]!.id,
      a[1]!.id,
    ]
    const items = await getBatchItems({ ids })
    expect(items.map((i) => i.id)).toEqual([a[1]!.id])
    expect(collectImages(items).length).toBe(1)
  })

  test('input limits', async () => {
    expect(await getBatchItems({ ids: [] })).toEqual([])
    await expect(getBatchItems({ ids: ['nope'] })).rejects.toThrow()
    await expect(getBatchItems({ ids: Array.from({ length: 501 }, (_, i) => `r-${i.toString(16).padStart(20, '0')}`) })).rejects.toThrow()
  })
})
