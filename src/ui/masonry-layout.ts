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
