import { describe, expect, test } from 'bun:test'
import {
  allLayouts,
  breakpointFor,
  containerVars,
  itemHeight,
  itemVars,
  laneLeft,
  lanesFor,
  MASONRY_MODES,
  masonryColumns,
  placeItems,
  type Shape,
} from '#/ui/masonry-layout'

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

describe('SSR-stable layout (what <Masonry> renders)', () => {
  // height = ratio × laneWidth + chrome
  const shapes: Shape[] = [1, 2, 0.5, 1, 1.5, 1, 0.5].map((ratio) => ({ ratio, chrome: { desktop: 40, phone: 30 } }))

  test('lane counts follow the container-query breakpoints in components.css', () => {
    const d = MASONRY_MODES.desktop
    const p = MASONRY_MODES.phone
    expect([2, 3, 4, 5].map((n) => breakpointFor(n, d))).toEqual([516, 784, 1052, 1320])
    expect([3, 4].map((n) => breakpointFor(n, p))).toEqual([474, 636])
    // 1376 = the 1440 px container minus 2 × 32 px gutters
    expect([300, 515, 516, 783, 784, 1051, 1052, 1216, 1319, 1320, 1376, 2000].map((w) => lanesFor(w, d))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5])
    // phones keep two lanes even on a 320 px screen
    expect([288, 358, 474, 636, 728].map((w) => lanesFor(w, p))).toEqual([2, 2, 3, 4, 4])
  })

  test('the CSS breakpoints are the ones the geometry uses', async () => {
    const css = await Bun.file(new URL('../../src/ui/styles/components.css', import.meta.url)).text()
    const block = css.slice(css.indexOf('.vmasonry'), css.indexOf('/* ============ character card'))
    const found = [...block.matchAll(/@container \(min-width: (\d+)px\)/g)].map((m) => Number(m[1]))
    expect(found).toEqual([516, 784, 1052, 1320, 474, 636])
  })

  test('shortest lane first; offsets are affine in the lane width', () => {
    const { places, ends } = placeItems(shapes, 3, 'desktop')
    expect(places.map((p) => p.lane)).toEqual([0, 1, 2, 2, 0, 2, 1])
    // item 3 sits under item 2 (ratio 0.5 + chrome 40 + gap 20)
    expect(places[3]).toEqual({ lane: 2, a: 0.5, b: 60 })
    const lw = 300
    const top = (i: number) => places[i]!.a * lw + places[i]!.b
    const height = (i: number) => shapes[i]!.ratio * lw + 40
    // every lane is a gap-separated stack
    for (const lane of [0, 1, 2]) {
      const idx = places.map((p, i) => [p, i] as const).filter(([p]) => p.lane === lane).map(([, i]) => i)
      for (let k = 1; k < idx.length; k++) expect(top(idx[k]!)).toBeCloseTo(top(idx[k - 1]!) + height(idx[k - 1]!) + 20, 6)
      const last = idx[idx.length - 1]!
      expect(ends[lane]!.a * lw + ends[lane]!.b).toBeCloseTo(top(last) + height(last), 6)
    }
  })

  test('appending items never moves the ones already placed (infinite loading)', () => {
    const a = placeItems(shapes.slice(0, 4), 2, 'phone').places
    const b = placeItems(shapes, 2, 'phone').places
    expect(b.slice(0, 4)).toEqual(a)
  })

  test('custom properties cover every variant the CSS can pick', () => {
    const layouts = allLayouts(shapes)
    const vars = itemVars(4, shapes[4]!, layouts)
    for (const tag of ['d1', 'd2', 'd3', 'd4', 'd5', 'p2', 'p3', 'p4']) {
      expect(vars).toHaveProperty(`--l-${tag}`)
      expect(vars).toHaveProperty(`--a-${tag}`)
      expect(vars).toHaveProperty(`--b-${tag}`)
    }
    expect(vars['--r']).toBe(1.5)
    const c = containerVars(layouts)
    expect(c['--h-d1']).toMatch(/^calc\(/)
    expect(c['--h-d3']).toMatch(/^max\(calc\(.*\), calc\(.*\), calc\(.*\)\)$/)
  })
})
