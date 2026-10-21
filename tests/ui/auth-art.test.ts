import { describe, expect, test } from 'bun:test'
import type { EmojiImage, PackCard } from '#/server/catalog/types'
import { ART_STICKERS, pickArtStickers } from '#/ui/account/art'

// The sticker wall on the auth pages (src/ui/account/art.ts): which home stickers it shows.

function img(id: string, width = 300, height = 300): EmojiImage {
  return { id, poster: `/img/v1/p240/k/${id}.r1.webp`, preview: null, full: `/img/v1/full/k/${id}.r1.webp`, width, height, frames: 1 }
}

function pack(id: number, cover: string | null, minis: string[]): PackCard {
  return {
    id,
    slug: `p${id}`,
    title: `p${id}`,
    excerpt: null,
    kind: 'static',
    sourceKind: 'community',
    pinLevel: 0,
    memorial: false,
    downloadable: true,
    count: 4,
    downloads: 0,
    favorites: 0,
    publishedAt: '2026-10-01T00:00:00.000Z',
    accent: null,
    cover: cover ? img(cover) : null,
    minis: minis.map((m) => img(m)),
    characters: [],
    artists: [],
  }
}

describe('pickArtStickers', () => {
  test('covers of every pack first, then their minis; each pack and sticker once', () => {
    const a = pack(1, 'a0', ['a1', 'a2', 'a3'])
    const b = pack(2, 'b0', ['b1'])
    const c = pack(3, null, ['c1', 'c2'])
    const picked = pickArtStickers({ pinned: [a], featured: [b, a], latest: [c, b], official: [] }, 7)
    expect(picked.map((s) => s.id)).toEqual(['a0', 'b0', 'a1', 'b1', 'c1', 'a2', 'c2'])
  })

  test('stops at the count and is the same every time', () => {
    const packs = Array.from({ length: 30 }, (_, i) => pack(i, `s${i}-0`, [`s${i}-1`, `s${i}-2`, `s${i}-3`]))
    const home = { pinned: [], featured: [], latest: packs, official: [] }
    const one = pickArtStickers(home)
    expect(one).toHaveLength(ART_STICKERS)
    expect(pickArtStickers(home)).toEqual(one)
  })

  test('the poster size: longest edge 240, the original aspect', () => {
    const p = pack(1, null, [])
    p.cover = img('wide', 600, 300)
    p.minis = [img('tall', 100, 400)]
    const [wide, tall] = pickArtStickers({ pinned: [p], featured: [], latest: [], official: [] })
    expect(wide).toEqual({ id: 'wide', src: '/img/v1/p240/k/wide.r1.webp', w: 240, h: 120 })
    expect(tall).toMatchObject({ w: 60, h: 240 })
  })

  test('an empty catalog gives an empty wall', () => {
    expect(pickArtStickers({ pinned: [], featured: [], latest: [], official: [] })).toEqual([])
  })
})
