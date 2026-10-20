// Pack card text rows in height tiers (pure; unit-tested in tests/ui/pack-card-tiers.test.ts).
//
// The masonry is laid out on the server (masonry-layout.ts), so every card height must be known
// without measuring text. Instead of one fixed height for every card (which turns the waterfall into a
// grid), each card picks its own row counts from its content: a short title takes one line, a long
// excerpt three, character tags wrap to a second row, the stats wrap the date onto its own line on
// phones. The counts are estimated from the text (CJK glyphs are 1em wide, Latin ≈ 0.56em) at a
// typical lane width; CSS clamps text to the chosen lines and never shows a partial tag row, so an
// estimate that is off by a little leaves a short gap or an ellipsis, never a cut tag. Tag rows are
// fitted at the narrowest card body a layout can produce, so a tag is never pushed into a hidden row.

import { MASONRY_MODES } from './masonry-layout'

export interface CardTierInput {
  title: string
  /** shown excerpt (null when the card hides it) */
  excerpt: string | null
  /** character tag labels, in order */
  characters: readonly string[]
  /** stat labels as rendered (downloads, favorites, date); missing ones omitted */
  stats: readonly string[]
}

export interface ModeTiers {
  /** title lines (1–2) */
  title: number
  /** excerpt lines (0 when there is none) */
  excerpt: number
  /** character tag rows (0 when there are no characters) */
  chars: number
  /** stat rows (1–2) */
  meta: number
}

export interface CardTiers {
  desktop: ModeTiers
  phone: ModeTiers
  /** character tags shown before the "+N" tag */
  shownChars: number
}

/** Text widths (px) the estimates assume; the card body is lane width − 2·border − 2·padding. */
export const TIER_TEXT = {
  desktop: { width: 232, title: 16.5, excerpt: 13, maxExcerpt: 3 },
  phone: { width: 140, title: 14.5, excerpt: 12.5, maxExcerpt: 2 },
} as const
/** Card chrome around the body text (components.css, pack card): 2 px border, body padding per mode. */
const CARD_SIDE = { desktop: 2 * 2 + 2 * 16, phone: 2 * 2 + 2 * 12 } as const
/** Narrowest viewport we lay out for, and the page gutter there (tokens.css: clamp(16px, 3vw, 32px)). */
const MIN_VIEWPORT = 320
const MIN_GUTTER = 16
/**
 * Narrowest card body per mode: desktop lanes are never below MASONRY_MODES.desktop.min; phones keep
 * minLanes lanes even when that makes them narrower than the minimum (320 px viewport: 138 px lanes).
 */
export const TAG_WIDTH = {
  desktop: MASONRY_MODES.desktop.min - CARD_SIDE.desktop,
  phone: Math.min(MASONRY_MODES.phone.min, (MIN_VIEWPORT - 2 * MIN_GUTTER - (MASONRY_MODES.phone.minLanes - 1) * MASONRY_MODES.phone.gap) / MASONRY_MODES.phone.minLanes) - CARD_SIDE.phone,
} as const
const TAG = { font: 12.5, pad: 23, gap: 5 } as const
const STAT = { font: 13, icon: 20, gap: { desktop: 12, phone: 9 } } as const
const MAX_TAG_ROWS = 2
const MAX_CHARS = 3

/** Width of a string in em: CJK and full-width forms 1, spaces 0.3, other characters 0.56. */
export function textEm(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 0x20) w += 0.3
    else if (c >= 0x2e80 || (c >= 0x3000 && c <= 0x30ff) || (c >= 0xff00 && c <= 0xffef)) w += 1
    else w += 0.56
  }
  return w
}

function lines(em: number, perLine: number, max: number): number {
  if (em <= 0) return 0
  return Math.min(max, Math.ceil(em / perLine - 0.05))
}

/** Rows a sequence of inline items of the given widths takes in `width` with `gap` between items. */
export function rowsFor(widths: readonly number[], width: number, gap: number): number {
  if (!widths.length) return 0
  let rows = 1
  let x = 0
  for (const w of widths) {
    if (x > 0 && x + gap + w > width) {
      rows++
      x = w
    } else x = x > 0 ? x + gap + w : w
  }
  return rows
}

const tagWidths = (labels: readonly string[]) => labels.map((l) => textEm(l) * TAG.font + TAG.pad)

export function cardTiers(p: CardTierInput): CardTiers {
  const total = p.characters.length
  // as many tags as fit in two rows on a phone (the narrower case), plus "+N" for the rest
  let shown = Math.min(MAX_CHARS, total)
  const labelsFor = (n: number) => [...p.characters.slice(0, n), ...(total > n ? [`+${total - n}`] : [])]
  while (shown > 1 && rowsFor(tagWidths(labelsFor(shown)), TAG_WIDTH.phone, TAG.gap) > MAX_TAG_ROWS) shown--
  const tags = tagWidths(labelsFor(shown))
  const statW = p.stats.map((s) => STAT.icon + textEm(s) * STAT.font)
  const mode = (m: 'desktop' | 'phone'): ModeTiers => {
    const t = TIER_TEXT[m]
    return {
      title: Math.max(1, lines(textEm(p.title), t.width / t.title, 2)),
      excerpt: p.excerpt ? lines(textEm(p.excerpt), t.width / t.excerpt, t.maxExcerpt) : 0,
      chars: total ? Math.min(MAX_TAG_ROWS, rowsFor(tags, TAG_WIDTH[m], TAG.gap)) : 0,
      meta: Math.max(1, Math.min(2, rowsFor(statW, t.width, STAT.gap[m]))),
    }
  }
  return { desktop: mode('desktop'), phone: mode('phone'), shownChars: shown }
}
