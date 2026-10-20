// Layout of the 潮汐画廊 stream (pure; unit-tested in tests/ui/stream-layout.test.ts).
//
// The prototype's stream is a square-tile grid with `grid-auto-flow: dense`: every eleventh sticker is
// a 2×2 focus tile, and pack cards (2×3) and a 潮汐小记 note (2×2) sit between the stickers; on phones
// cards and notes take the full width. Before the script runs (server HTML) the browser places the
// cells; once the grid is measured StreamGrid places them itself with placeDense(), which follows the
// CSS dense algorithm exactly, so the switch moves nothing, and then mounts only the rows near the
// viewport.

export type CellKind = 'tile' | 'big' | 'card' | 'note'

export interface Span {
  w: number
  h: number
}

/** Cell size in grid tracks for a kind, given the column count and the phone layout. */
export function spanOf(kind: CellKind, cols: number, phone: boolean): Span {
  const fit = (w: number) => Math.max(1, Math.min(cols, w))
  switch (kind) {
    case 'tile':
      return { w: 1, h: 1 }
    case 'big':
      return { w: fit(2), h: cols < 2 ? 1 : 2 }
    case 'card':
      return phone ? { w: cols, h: 2 } : { w: fit(2), h: 3 }
    case 'note':
      return phone ? { w: cols, h: 1 } : { w: fit(2), h: 2 }
  }
}

export interface Placement {
  row: number
  col: number
}

/**
 * CSS Grid auto-placement with `grid-auto-flow: dense` (row-major, every item searched from the
 * top-left): the first position where the item fits.
 */
export function placeDense(spans: readonly Span[], cols: number): { places: Placement[]; rows: number } {
  const taken: boolean[][] = []
  const free = (r: number, c: number, s: Span) => {
    for (let y = r; y < r + s.h; y++) for (let x = c; x < c + s.w; x++) if (taken[y]?.[x]) return false
    return true
  }
  const places: Placement[] = []
  let rows = 0
  for (const s of spans) {
    const span = { w: Math.min(s.w, cols), h: s.h }
    let r = 0
    let c = 0
    for (;;) {
      if (c + span.w <= cols && free(r, c, span)) break
      c++
      if (c + span.w > cols) {
        c = 0
        r++
      }
    }
    for (let y = r; y < r + span.h; y++) {
      const row = (taken[y] ??= [])
      for (let x = c; x < c + span.w; x++) row[x] = true
    }
    places.push({ row: r, col: c })
    rows = Math.max(rows, r + span.h)
  }
  return { places, rows }
}

/** Stickers per loaded page of the gallery (galleryFn limit). */
export const STREAM_PAGE = 60
/** Positions (within each page) where a pack card goes in front of the sticker, and the note's. */
export const CARD_AT = [6, 26] as const
export const NOTE_AT = 15
/** A card needs this many stickers after it in its page, so no row is left without a sticker. */
const CARD_TAIL = 24

export type StreamEntry = { kind: 'tile' | 'big'; index: number } | { kind: 'card'; card: number } | { kind: 'note' }

/**
 * The sequence of cells for `count` stickers: sticker i is a focus tile when i % 11 === 3; page k
 * (STREAM_PAGE stickers) gets pack cards 2k and 2k+1 at CARD_AT (each card once, while there are
 * cards), the first page the note at NOTE_AT.
 * Cells only depend on stickers already loaded and appear within the new page, so loading more never
 * moves what is above.
 */
export function streamEntries(count: number, cards: number, note: boolean): StreamEntry[] {
  const out: StreamEntry[] = []
  for (let i = 0; i < count; i++) {
    const page = Math.floor(i / STREAM_PAGE)
    const at = i - page * STREAM_PAGE
    const pageEnd = Math.min(count, (page + 1) * STREAM_PAGE)
    const slot = CARD_AT.indexOf(at as (typeof CARD_AT)[number])
    const card = page * CARD_AT.length + slot
    if (slot >= 0 && card < cards && pageEnd - i >= CARD_TAIL) out.push({ kind: 'card', card })
    if (note && page === 0 && at === NOTE_AT && pageEnd - i >= CARD_TAIL) out.push({ kind: 'note' })
    out.push({ kind: i % 11 === 3 ? 'big' : 'tile', index: i })
  }
  return out
}
