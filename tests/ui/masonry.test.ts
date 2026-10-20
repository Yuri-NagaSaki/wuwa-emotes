import { describe, expect, test } from 'bun:test'
import { Virtualizer } from '@tanstack/react-virtual'
import { itemHeight, laneLeft, masonryColumns } from '#/ui/masonry-layout'

describe('masonryColumns', () => {
  test('fits as many lanes as the minimum width allows', () => {
    // desktop page content: 1240 - 2 × 32 gutter
    expect(masonryColumns(1176, { minColumnWidth: 248, gap: 20 })).toEqual({ lanes: 4, laneWidth: (1176 - 3 * 20) / 4 })
    // phone: 390 - 2 × 16 gutter
    expect(masonryColumns(358, { minColumnWidth: 150, gap: 12 })).toEqual({ lanes: 2, laneWidth: (358 - 12) / 2 })
  })

  test('caps lanes and never drops below one', () => {
    expect(masonryColumns(4000, { minColumnWidth: 100, gap: 10, maxLanes: 6 }).lanes).toBe(6)
    expect(masonryColumns(80, { minColumnWidth: 150, gap: 12 })).toEqual({ lanes: 1, laneWidth: 80 })
    expect(masonryColumns(0, { minColumnWidth: 150, gap: 12 })).toEqual({ lanes: 1, laneWidth: 0 })
  })

  test('lane offsets step by lane width + gap', () => {
    expect([0, 1, 2].map((l) => laneLeft(l, 279, 20))).toEqual([0, 299, 598])
  })
})

describe('itemHeight', () => {
  test('scales stored dimensions to the lane width and adds chrome', () => {
    expect(itemHeight(300, 300, 200)).toBe(200)
    expect(itemHeight(240, 320, 180)).toBe(240)
    expect(itemHeight(320, 240, 200, 36)).toBe(186)
  })

  test('missing or broken dimensions fall back to a square', () => {
    expect(itemHeight(null, 300, 150)).toBe(150)
    expect(itemHeight(0, 0, 150)).toBe(150)
    expect(itemHeight(-5, 10, 150)).toBe(150)
  })
})

describe('lane assignment (TanStack Virtual, configured like <Masonry>)', () => {
  const dims: [number, number][] = [
    [300, 300],
    [300, 600],
    [300, 150],
    [300, 300],
    [300, 450],
    [300, 300],
    [300, 150],
  ]

  function layout(lanes: number, laneWidth: number, gap: number) {
    const v = new Virtualizer<Window, Element>({
      count: dims.length,
      getScrollElement: () => null,
      estimateSize: (i) => itemHeight(dims[i]![0], dims[i]![1], laneWidth),
      scrollToFn: () => undefined,
      observeElementRect: () => undefined,
      observeElementOffset: () => undefined,
      lanes,
      gap,
      laneAssignmentMode: 'estimate',
      // a tall viewport so every item is in range (what <Masonry> renders comes from the same list)
      initialRect: { width: 3 * laneWidth, height: 10_000 },
      overscan: dims.length,
    })
    return v.getVirtualItems().map((m) => ({ lane: m.lane, start: m.start, size: m.size }))
  }

  test('each item goes to the lane that currently ends highest', () => {
    const ms = layout(3, 100, 10)
    // first row fills lanes 0..2, then shortest-lane-first
    expect(ms.map((m) => m.lane)).toEqual([0, 1, 2, 2, 0, 2, 1])
    expect(ms.map((m) => m.size)).toEqual([100, 200, 50, 100, 150, 100, 50])
    expect(ms[3]!.start).toBe(60) // under the 50px item in lane 2, plus the gap
    expect(ms[4]!.start).toBe(110) // lane 0 ended at 100
  })

  test('replaying the same heights gives the same layout (no shift)', () => {
    expect(layout(3, 100, 10)).toEqual(layout(3, 100, 10))
  })

  test('one lane stacks everything', () => {
    const ms = layout(1, 100, 10)
    expect(ms.every((m) => m.lane === 0)).toBe(true)
    expect(ms[1]!.start).toBe(110)
  })
})
