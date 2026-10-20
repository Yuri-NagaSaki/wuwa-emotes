import { describe, expect, test } from 'bun:test'
import { cardTiers, rowsFor, TAG_WIDTH, textEm } from '#/ui/pack-card-tiers'
import { CARD_AT, NOTE_AT, placeDense, spanOf, STREAM_PAGE, streamEntries } from '#/ui/pages/stream-layout'

describe('pack card tiers', () => {
  test('text width: CJK 1em, Latin narrower', () => {
    expect(textEm('爱弥斯')).toBe(3)
    expect(textEm('abc')).toBeCloseTo(1.68, 6)
    expect(textEm('a b')).toBeCloseTo(1.42, 6)
  })

  test('inline items wrap by whole items', () => {
    expect(rowsFor([], 100, 5)).toBe(0)
    expect(rowsFor([40, 40], 100, 5)).toBe(1)
    expect(rowsFor([40, 40, 40], 100, 5)).toBe(2)
    expect(rowsFor([120], 100, 5)).toBe(1)
  })

  test('tag rows are fitted at the narrowest card body (320 px phone: 110 px; desktop: 212 px)', () => {
    expect(TAG_WIDTH.phone).toBe(110)
    expect(TAG_WIDTH.desktop).toBe(212)
    // three long names cannot share two rows at 110 px: the third becomes +N
    const t = cardTiers({ title: '标题', excerpt: null, characters: ['秧秧·玄翎', '卡提希娅', '嘉贝莉娜'], stats: [] })
    expect(t.shownChars).toBeLessThan(3)
    expect(t.phone.chars).toBeLessThanOrEqual(2)
  })

  test('tags: at most two rows on the narrowest phone lane, the rest as +N', () => {
    const t = cardTiers({ title: '标题', excerpt: null, characters: ['秧秧·玄翎', '卡提希娅', '嘉贝莉娜', '守岸人', '椿'], stats: ['1', '2', '10-20'] })
    expect(t.shownChars).toBeLessThanOrEqual(3)
    expect(t.phone.chars).toBeLessThanOrEqual(2)
    expect(t.desktop.chars).toBeLessThanOrEqual(t.phone.chars)
    const none = cardTiers({ title: '标题', excerpt: null, characters: [], stats: [] })
    expect(none.desktop.chars).toBe(0)
    expect(none.desktop.meta).toBe(1)
  })
})

describe('潮汐画廊 stream layout', () => {
  test('dense placement fills holes like CSS grid', () => {
    // 4 columns: a 2×2 at the start, then 1×1s fill the rest of rows 0–1 before row 2
    const { places, rows } = placeDense([{ w: 2, h: 2 }, ...Array(6).fill({ w: 1, h: 1 })], 4)
    expect(places.map((p) => [p.row, p.col])).toEqual([
      [0, 0],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 0],
      [2, 1],
    ])
    expect(rows).toBe(3)
    // a later small item goes back up into an earlier hole
    const hole = placeDense([{ w: 1, h: 1 }, { w: 3, h: 1 }, { w: 1, h: 1 }], 3)
    expect(hole.places.map((p) => [p.row, p.col])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ])
  })

  test('cards are 2×3 on desktop and full width on phones; nothing is wider than the grid', () => {
    expect(spanOf('card', 9, false)).toEqual({ w: 2, h: 3 })
    expect(spanOf('card', 3, true)).toEqual({ w: 3, h: 2 })
    expect(spanOf('note', 3, true)).toEqual({ w: 3, h: 1 })
    expect(spanOf('big', 1, false)).toEqual({ w: 1, h: 1 })
  })

  test('cells: every eleventh sticker is a focus tile, cards per page, the note once', () => {
    const e = streamEntries(STREAM_PAGE * 2, 3, true)
    const stickers = e.filter((x) => x.kind === 'tile' || x.kind === 'big')
    expect(stickers.length).toBe(STREAM_PAGE * 2)
    expect(e.filter((x) => x.kind === 'big').map((x) => (x as { index: number }).index).slice(0, 3)).toEqual([3, 14, 25])
    expect(e.filter((x) => x.kind === 'card').map((x) => (x as { card: number }).card)).toEqual([0, 1, 2])
    expect(e.filter((x) => x.kind === 'note').length).toBe(1)
    // a card sits in front of the sticker at CARD_AT[0]; the note in front of NOTE_AT
    const at = (i: number) => e.findIndex((x) => (x.kind === 'tile' || x.kind === 'big') && x.index === i)
    expect(e[at(CARD_AT[0]) - 1]!.kind).toBe('card')
    expect(e[at(NOTE_AT) - 1]!.kind).toBe('note')
  })

  test('loading more stickers never changes the cells already there', () => {
    const one = streamEntries(STREAM_PAGE, 4, true)
    const two = streamEntries(STREAM_PAGE * 2, 4, true)
    expect(two.slice(0, one.length)).toEqual(one)
    // and the placement of those cells stays the same
    const spans = (list: typeof one) => list.map((x) => spanOf(x.kind, 9, false))
    expect(placeDense(spans(two), 9).places.slice(0, one.length)).toEqual(placeDense(spans(one), 9).places)
  })

  test('a short last page gets no card without stickers after it', () => {
    expect(streamEntries(20, 4, true).some((x) => x.kind === 'card' || x.kind === 'note')).toBe(false)
  })
})
