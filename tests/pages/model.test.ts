import { describe, expect, test } from 'bun:test'
import type { PackCard } from '#/server/catalog/types'
import { packCardShape, packCardTiers } from '#/ui/PackCard'
import { cardFlags, cardProps, characterColor, licenseLabel, longDate, packAccent, paletteColor, shortDate, tagHref, themeColor } from '#/ui/pages/model'

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
    expect(themeColor('var(--c-pink)')).toBe('var(--c-pink)')
    expect(themeColor('var(--c-nope)', 'fb')).toBe('fb')
    expect(themeColor('red; background: url(x)')).toBe('var(--c-mint)')
    expect(themeColor(null, 'var(--c-pink)')).toBe('var(--c-pink)')
  })

  test('character colors: theme_color when set, else a stable palette pick', () => {
    expect(characterColor({ slug: 'aimisi', color: 'pink' })).toBe('var(--c-pink)')
    const pick = characterColor({ slug: 'daniya', color: null })
    expect(pick).toMatch(/^var\(--c-[a-z]+\)$/)
    expect(characterColor({ slug: 'daniya', color: null })).toBe(pick)
    expect(paletteColor('daniya')).toBe(pick)
    // the 13 design colors all occur over a few dozen slugs
    expect(new Set(Array.from({ length: 80 }, (_, i) => paletteColor(`c${i}`))).size).toBe(13)
    // a pack takes its first character's color, else its own pick
    expect(packAccent(card())).toBe('var(--c-pink)')
    expect(packAccent(card({ characters: [{ slug: 'daniya', name: '达妮娅', color: null }] }))).toBe(pick)
    expect(packAccent(card({ characters: [], accent: null }))).toBe(paletteColor('aimisi-01'))
    expect(cardProps(card({ characters: [{ slug: 'daniya', name: '达妮娅', color: null }] }), 0).characters).toEqual([{ name: '达妮娅', color: pick }])
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
  const body = (mode: 'desktop' | 'phone', t: { title: number; excerpt: number; chars: number; meta: number }, credit: boolean) => {
    const c = mode === 'desktop' ? { top: 14, bottom: 16, gap: 9, title: 22, excerpt: 20, credit: 30 } : { top: 10, bottom: 12, gap: 7, title: 20, excerpt: 18, credit: 0 }
    const rows = [t.title * c.title, t.excerpt * c.excerpt, t.chars ? t.chars * 26 + (t.chars - 1) * 5 : 0, t.meta * 20 + (t.meta - 1) * 4, credit ? c.credit : 0].filter((h) => h > 0)
    return c.top + c.bottom + rows.reduce((a, b) => a + b, 0) + c.gap * (rows.length - 1)
  }

  test('rows: each card at its own line counts; no credit row on phones', () => {
    // 2 border + (w − 4) cover cancel out for the single cover: chrome is the body
    for (const over of [{ characters: [], artists: [] }, { excerpt: '一段简介' }, { excerpt: '很长的简介'.repeat(12), title: '爱弥斯与达妮娅的长长长长长长长长长标题' }]) {
      const props = cardProps(card(over), 0, { variant: 'one' })
      const t = packCardTiers(props)
      const shape = packCardShape(props)
      const credit = (props.artists?.length ?? 0) > 0
      expect(shape.ratio).toBe(1)
      expect(shape.chrome.desktop).toBeCloseTo(body('desktop', t.desktop, credit), 6)
      expect(shape.chrome.phone).toBeCloseTo(body('phone', t.phone, false), 6)
    }
  })

  test('tiers follow the content', () => {
    const short = packCardTiers(cardProps(card(), 0))
    const long = packCardTiers(cardProps(card({ title: '爱弥斯与达妮娅的长长长长长长长长长标题', excerpt: '很长的简介'.repeat(12) }), 0))
    expect(short.desktop.title).toBe(1)
    expect(long.desktop.title).toBe(2)
    expect(short.desktop.excerpt).toBe(0)
    expect(long.desktop.excerpt).toBe(3)
    expect(long.phone.excerpt).toBe(2)
    // phones put the date on its own row
    expect(short.phone.meta).toBe(2)
    expect(short.desktop.meta).toBe(1)
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

  test('the per-line row heights match components.css', async () => {
    const css = await Bun.file(new URL('../../src/ui/styles/components.css', import.meta.url)).text()
    const rule = (sel: string) => css.split('\n').find((l) => l.trimStart().startsWith(sel + ' {'))!
    expect(rule('.pcard-body h3')).toContain('height: calc(var(--ti, 2) * 22px)')
    expect(rule('.pcard-ex')).toContain('height: calc(var(--ex, 2) * 20px)')
    expect(rule('.pcard-chars')).toContain('height: calc(var(--ch, 1) * 31px - 5px)')
    expect(rule('.pcard-meta')).toContain('height: calc(var(--me, 1) * 24px - 4px)')
    expect(rule('.pcard-credit')).toContain('height: 30px')
    expect(rule('.pcard-body')).toContain('padding: 14px 16px 16px')
    expect(rule('.pcard-body')).toContain('gap: 9px')
    const phone = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(phone).toContain('.pcard-body h3 { font-size: 14.5px; line-height: 20px; height: calc(var(--ti-p, 2) * 20px);')
    expect(phone).toContain('.pcard-ex { font-size: 12.5px; line-height: 18px; height: calc(var(--ex-p, 2) * 18px);')
    expect(phone).toContain('.pcard-meta { gap: 4px 9px; height: calc(var(--me-p, 2) * 24px - 4px); }')
    expect(phone).toContain('.pcard-chars { height: calc(var(--ch-p, 1) * 31px - 5px); }')
    expect(phone).toContain('.pcard-body { padding: 10px 12px 12px; gap: 7px; }')
    expect(phone).toContain('.pcard-cover { padding: 8px; }')
  })
})
