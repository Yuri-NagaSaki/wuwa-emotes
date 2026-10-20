// Masonry geometry (pure, unit-tested). Lane assignment itself is TanStack Virtual's: each item goes to
// the lane that currently ends highest, so these helpers only decide how many lanes there are and how
// tall each item is. Heights come from the stored width/height of the media, never from measuring the
// DOM, so nothing moves when images load.

export interface ColumnOptions {
  /** Smallest lane width in px (prototype: 248 desktop, 150 phone). */
  minColumnWidth: number
  gap: number
  maxLanes?: number
}

export interface Columns {
  lanes: number
  laneWidth: number
}

export function masonryColumns(containerWidth: number, { minColumnWidth, gap, maxLanes = 8 }: ColumnOptions): Columns {
  const width = Math.max(0, containerWidth)
  const fit = Math.floor((width + gap) / (minColumnWidth + gap))
  const lanes = Math.max(1, Math.min(maxLanes, fit))
  const laneWidth = Math.max(0, (width - gap * (lanes - 1)) / lanes)
  return { lanes, laneWidth }
}

/**
 * Height of an item whose media is `w × h`, drawn at the lane width, plus fixed chrome (caption,
 * padding). Unknown or broken dimensions fall back to a square.
 */
export function itemHeight(w: number | null | undefined, h: number | null | undefined, laneWidth: number, chrome = 0): number {
  const ratio = w && h && w > 0 && h > 0 ? h / w : 1
  return Math.round(laneWidth * ratio + chrome)
}

/** Left offset of a lane. */
export function laneLeft(lane: number, laneWidth: number, gap: number): number {
  return lane * (laneWidth + gap)
}

// ---- SSR-stable masonry (what <Masonry> renders) ----
//
// The server does not know the viewport, and the HTML is shared through the CDN, so the layout cannot
// depend on a measured width. Instead every item height is affine in the lane width
// (height = ratio × laneWidth + chrome: media scaled to the lane plus fixed-height text rows), and
// lanes are assigned once per lane count at a reference lane width. Then an item's offset is also
// affine (top = a × laneWidth + b), so CSS can place it exactly for any container width with calc()
// and container queries (components.css, "masonry"). Server HTML, hydration and every resize agree,
// and images loading or fonts swapping never move anything.

export type MasonryModeName = 'desktop' | 'phone'

export interface MasonryMode {
  /** Smallest lane width (px). */
  min: number
  gap: number
  minLanes: number
  maxLanes: number
}

/** Must match the container queries in components.css (".vm-"). Phone = viewport ≤ 760px. */
export const MASONRY_MODES: Record<MasonryModeName, MasonryMode> = {
  desktop: { min: 248, gap: 20, minLanes: 1, maxLanes: 5 },
  phone: { min: 150, gap: 12, minLanes: 2, maxLanes: 4 },
}

export function lanesFor(containerWidth: number, mode: MasonryMode): number {
  const fit = Math.floor((Math.max(0, containerWidth) + mode.gap) / (mode.min + mode.gap))
  return Math.max(mode.minLanes, Math.min(mode.maxLanes, fit))
}

/** Container width at which `lanes` lanes start (the container-query breakpoint). */
export function breakpointFor(lanes: number, mode: MasonryMode): number {
  return lanes * mode.min + (lanes - 1) * mode.gap
}

export function laneWidthFor(containerWidth: number, lanes: number, gap: number): number {
  return Math.max(0, (containerWidth - gap * (lanes - 1)) / lanes)
}

/** height = ratio × laneWidth + chrome[mode] */
export interface Shape {
  ratio: number
  chrome: Record<MasonryModeName, number>
}

/** top = a × laneWidth + b, in lane `lane`. */
export interface Placement {
  lane: number
  a: number
  b: number
}

export interface Layout {
  places: Placement[]
  /** Bottom of each lane (without the trailing gap): a × laneWidth + b. */
  ends: { a: number; b: number }[]
}

/** Reference lane width used to compare lanes (middle of the range where this lane count applies). */
export function referenceLaneWidth(lanes: number, mode: MasonryMode): number {
  return mode.min + (mode.min + mode.gap) / (2 * lanes)
}

/** Shortest-lane-first at the reference width; ties go to the lowest lane. Pure and deterministic. */
export function placeItems(shapes: readonly Shape[], lanes: number, modeName: MasonryModeName): Layout {
  const mode = MASONRY_MODES[modeName]
  const ref = referenceLaneWidth(lanes, mode)
  const cols = Array.from({ length: lanes }, () => ({ a: 0, b: 0, n: 0 }))
  const places: Placement[] = []
  for (const s of shapes) {
    let best = 0
    for (let l = 1; l < lanes; l++) if (cols[l]!.a * ref + cols[l]!.b < cols[best]!.a * ref + cols[best]!.b - 1e-6) best = l
    const c = cols[best]!
    places.push({ lane: best, a: c.a, b: c.b })
    c.a += s.ratio
    c.b += s.chrome[modeName] + mode.gap
    c.n++
  }
  return { places, ends: cols.map((c) => (c.n ? { a: c.a, b: c.b - mode.gap } : { a: 0, b: 0 })) }
}

/** Every lane count a mode can use, i.e. the variants the CSS switches between. */
export function laneCounts(mode: MasonryMode): number[] {
  return Array.from({ length: mode.maxLanes - mode.minLanes + 1 }, (_, i) => mode.minLanes + i)
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4

/** Inline custom properties of one item for every (mode, lane count) variant. */
export function itemVars(i: number, shape: Shape, layouts: Record<MasonryModeName, Layout[]>): Record<string, string | number> {
  const vars: Record<string, string | number> = { '--r': r4(shape.ratio), '--cd': r4(shape.chrome.desktop), '--cp': r4(shape.chrome.phone) }
  for (const name of ['desktop', 'phone'] as const) {
    const mode = MASONRY_MODES[name]
    for (const [k, n] of laneCounts(mode).entries()) {
      const p = layouts[name][k]!.places[i]!
      const tag = `${name[0]}${n}`
      vars[`--l-${tag}`] = p.lane
      vars[`--a-${tag}`] = r4(p.a)
      vars[`--b-${tag}`] = r4(p.b)
    }
  }
  return vars
}

/** Inline custom properties of the container: its height for every variant (CSS max() over lanes). */
export function containerVars(layouts: Record<MasonryModeName, Layout[]>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const name of ['desktop', 'phone'] as const) {
    const mode = MASONRY_MODES[name]
    for (const [k, n] of laneCounts(mode).entries()) {
      const ends = layouts[name][k]!.ends
      const terms = ends.map((e) => `calc(${r4(e.a)} * var(--lw) + ${r4(e.b)}px)`)
      vars[`--h-${name[0]}${n}`] = terms.length === 1 ? terms[0]! : `max(${terms.join(', ')})`
    }
  }
  return vars
}

export function allLayouts(shapes: readonly Shape[]): Record<MasonryModeName, Layout[]> {
  return {
    desktop: laneCounts(MASONRY_MODES.desktop).map((n) => placeItems(shapes, n, 'desktop')),
    phone: laneCounts(MASONRY_MODES.phone).map((n) => placeItems(shapes, n, 'phone')),
  }
}
