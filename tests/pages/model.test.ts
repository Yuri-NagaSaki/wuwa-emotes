import { describe, expect, test } from 'bun:test'
import type { PackCard } from '#/server/catalog/types'
import { packCardShape } from '#/ui/PackCard'
import { cardFlags, cardProps, licenseLabel, longDate, shortDate, tagHref, themeColor } from '#/ui/pages/model'

const card = (over: Partial<PackCard> = {}): PackCard => ({
  id: 1,
  slug: 'aimisi-01',
  title: '爱弥斯动态表情包',
  excerpt: null,
  kind: 'animated',
  sourceKind: 'community',
  pinLevel: 0,
  memorial: false,
  downloadable: true,
  count: 25,
  downloads: 18600,
  favorites: 3,
  publishedAt: '2026-10-19T16:30:00.000Z',
  accent: 'pink',
  cover: { id: 'r-00000000000000000001', poster: '/p0', preview: '/a0', full: '/f0', width: 300, height: 300, frames: 12 },
  minis: [1, 2, 3].map((i) => ({ id: `r-0000000000000000000${i + 1}`, poster: `/p${i}`, preview: null, full: `/f${i}`, width: 300, height: 300, frames: 1 })),
  characters: [{ slug: 'aimisi', name: '爱弥斯', color: 'pink' }],
  artists: [{ slug: 'wuxue', name: '雾雪' }],
  ...over,
})

describe('catalog DTO → UI', () => {
  test('theme colors: palette names become tokens, unsafe values fall back', () => {
    expect(themeColor('pink')).toBe('var(--c-pink)')
    expect(themeColor(' Teal ')).toBe('var(--c-teal)')
    expect(themeColor('#a1b2c3')).toBe('#a1b2c3')
    expect(themeColor('red; background: url(x)')).toBe('var(--c-mint)')
    expect(themeColor(null, 'var(--c-pink)')).toBe('var(--c-pink)')
  })

  test('dates are Asia/Shanghai days, identical on server and client', () => {
    // 16:30 UTC on the 19th is already the 20th in Shanghai
    expect(shortDate('2026-10-19T16:30:00.000Z')).toBe('10-20')
    expect(longDate('2026-10-19T15:59:59.000Z')).toBe('2026-10-19')
    expect(shortDate('not a date')).toBe('')
  })

  test('card props: cover first, cycling cover layouts, flags', () => {
    const p = cardProps(card(), 1)
    expect(p.href).toBe('/packs/aimisi-01')
    expect(p.images).toEqual(['/p0', '/p1', '/p2', '/p3'])
    expect(p.coverPreview).toBe('/a0')
    expect(p.variant).toBe('lead')
    expect(cardProps(card(), 4).variant).toBe('four')
    expect(cardFlags({ sourceKind: 'official', pinLevel: 2, memorial: true, kind: 'static' }, true)).toEqual(['official', 'pin', 'memorial', 'new', 'static'])
  })

  test('tag links: 分组 has its own parameter', () => {
    expect(tagHref('group', 'zhanzhangtuijian')).toBe('/packs?group=zhanzhangtuijian')
    expect(tagHref('project', 'solar5')).toBe('/packs?tag=project%3Asolar5')
  })

  test('license gloss', () => {
    expect(licenseLabel('CC BY-NC-SA 4.0')).toEqual({ badge: 'CC BY-NC-SA 4.0', text: '署名 · 非商业 · 相同方式共享' })
    expect(licenseLabel('unknown').badge).toBeNull()
  })
})

describe('pack card geometry (exact heights for the masonry)', () => {
  test('rows: title + meta always; excerpt, characters, credit when present; no credit row on phones', () => {
    const bare = packCardShape(cardProps(card({ characters: [], artists: [] }), 0, { variant: 'one' }))
    // desktop: 2 border + (w − 4) cover + 14 + 44 + 9 + 20 + 16 body
    expect(bare.ratio).toBe(1)
    expect(bare.chrome.desktop).toBeCloseTo(2 * 2 - 4 + 14 + 44 + 9 + 20 + 16, 6)
    const full = packCardShape(cardProps(card({ excerpt: '一段简介' }), 0, { variant: 'one' }))
    expect(full.chrome.desktop - bare.chrome.desktop).toBeCloseTo(9 + 40 + 9 + 26 + 9 + 30, 6)
    expect(full.chrome.phone - packCardShape(cardProps(card({ characters: [], artists: [] }), 0, { variant: 'one' })).chrome.phone).toBeCloseTo(7 + 36 + 7 + 26, 6)
  })

  test('cover layouts: lead is 8 px taller than four/one, strip scales by 31/30', () => {
    const four = packCardShape(cardProps(card(), 0, { variant: 'four' }))
    const lead = packCardShape(cardProps(card(), 0, { variant: 'lead' }))
    const strip = packCardShape(cardProps(card(), 0, { variant: 'strip' }))
    expect(lead.chrome.desktop - four.chrome.desktop).toBeCloseTo(8, 6)
    expect(strip.ratio).toBeCloseTo(31 / 30, 9)
    // fewer than four images: always the single-cover layout
    expect(packCardShape(cardProps(card({ minis: [] }), 0, { variant: 'lead' }))).toEqual(packCardShape(cardProps(card({ minis: [] }), 0, { variant: 'one' })))
  })

  test('the fixed row heights match components.css', async () => {
    const css = await Bun.file(new URL('../../src/ui/styles/components.css', import.meta.url)).text()
    const rule = (sel: string) => css.split('\n').find((l) => l.trimStart().startsWith(sel + ' {'))!
    expect(rule('.pcard-body h3')).toContain('height: 44px')
    expect(rule('.pcard-ex')).toContain('height: 40px')
    expect(rule('.pcard-chars')).toContain('height: 26px')
    expect(rule('.pcard-meta')).toContain('height: 20px')
    expect(rule('.pcard-credit')).toContain('height: 30px')
    expect(rule('.pcard-body')).toContain('padding: 14px 16px 16px')
    expect(rule('.pcard-body')).toContain('gap: 9px')
    const phone = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(phone).toContain('.pcard-body h3 { font-size: 14.5px; line-height: 20px; height: 40px; }')
    expect(phone).toContain('.pcard-ex { font-size: 12.5px; line-height: 18px; height: 36px; }')
    expect(phone).toContain('.pcard-body { padding: 10px 12px 12px; gap: 7px; }')
    expect(phone).toContain('.pcard-cover { padding: 8px; }')
  })
})
