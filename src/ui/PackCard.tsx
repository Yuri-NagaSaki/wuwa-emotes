import type { CSSProperties } from 'react'
import { Flag, Tag, type FlagKind } from './Chip'
import { cx } from './cx'
import { fmtN, fmtW } from './format'
import { Icon } from './Icon'
import { AppLink } from './link'
import type { Shape } from './masonry-layout'
import { cardTiers, type CardTiers } from './pack-card-tiers'
import { useAnimatedPreview } from './usePreview'

export type CoverVariant = 'one' | 'four' | 'lead' | 'strip'
export const COVER_VARIANTS: readonly CoverVariant[] = ['four', 'lead', 'one', 'strip']

export interface PackCardProps {
  href: string
  title: string
  excerpt?: string | null
  count: number
  /** Card accent (any CSS color, usually a character color var(--c-…)). */
  accent?: string
  /** p240 posters: the cover first, then up to three more. */
  images: readonly string[]
  /** a160 preview of the cover (plays on hover, like tiles). */
  coverPreview?: string | null
  /** Cover layout. Falls back to "one" when there are fewer than 4 images. */
  variant?: CoverVariant
  flags?: readonly FlagKind[]
  characters?: readonly { name: string; color?: string }[]
  downloads?: number
  favorites?: number
  /** Short date label, e.g. "10-09". */
  date?: string
  /** Artist credit line ("画师 …"). */
  artists?: readonly string[]
  /** Official pack: credit line says preview only. */
  official?: boolean
  /** Hide the excerpt (dense grids). */
  noExcerpt?: boolean
  enterIndex?: number
  /** Above the fold: load the cover eagerly with high priority (LCP candidates). */
  priority?: boolean
  className?: string
}

/** Resolve the cover layout the same way the prototype does. */
export function coverVariant(variant: CoverVariant, imageCount: number): CoverVariant {
  return imageCount < 4 ? 'one' : variant
}

// Geometry of the card (components.css, "pack card"): every text row has a fixed height per line and
// each card picks its line counts from its content (pack-card-tiers.ts), so the card height is an exact
// function of its width. Keep these numbers in sync with the CSS.
const CARD = {
  desktop: { pad: 12, top: 14, bottom: 16, gap: 9, titleLine: 22, excerptLine: 20, credit: 30 },
  phone: { pad: 8, top: 10, bottom: 12, gap: 7, titleLine: 20, excerptLine: 18, credit: 0 },
} as const
const TAG_ROW = 26
const TAG_ROW_GAP = 5
const META_ROW = 20
const META_ROW_GAP = 4
const BORDER = 2

type TierProps = Pick<PackCardProps, 'title' | 'excerpt' | 'noExcerpt' | 'characters' | 'downloads' | 'favorites' | 'date'>

/** Line and row counts of a card (same input on the server and in the browser). */
export function packCardTiers(p: TierProps): CardTiers {
  const stats = [p.downloads != null ? fmtW(p.downloads) : null, p.favorites != null ? fmtN(p.favorites) : null, p.date || null].filter((x): x is string => !!x)
  return cardTiers({
    title: p.title,
    excerpt: !p.noExcerpt && p.excerpt ? p.excerpt : null,
    characters: (p.characters ?? []).map((c) => c.name),
    stats,
  })
}

/** The tiers as the CSS variables the card's rows size themselves by. */
function tierVars(t: CardTiers): Record<string, number> {
  return {
    '--ti': t.desktop.title,
    '--ex': t.desktop.excerpt,
    '--ch': t.desktop.chars,
    '--me': t.desktop.meta,
    '--ti-p': t.phone.title,
    '--ex-p': t.phone.excerpt,
    '--ch-p': t.phone.chars,
    '--me-p': t.phone.meta,
  }
}

/** Which optional rows a card shows (same rules as <PackCard>). */
export function packCardRows(p: Pick<PackCardProps, 'excerpt' | 'noExcerpt' | 'characters' | 'artists' | 'official'>) {
  return {
    excerpt: !p.noExcerpt && !!p.excerpt,
    chars: (p.characters?.length ?? 0) > 0,
    credit: (p.artists?.length ?? 0) > 0 || !!p.official,
  }
}

/**
 * Card height as ratio × width + chrome, for <Masonry>. The cover is square-ish per variant (see
 * .cv.*), the body is the sum of its rows at the card's own line counts (packCardTiers). Phones hide
 * the credit row and use tighter padding.
 */
export function packCardShape(p: TierProps & Pick<PackCardProps, 'artists' | 'official' | 'variant' | 'images'>): Shape {
  const v = coverVariant(p.variant ?? 'four', p.images.length)
  const rows = packCardRows(p)
  const tiers = packCardTiers(p)
  const ratio = v === 'strip' ? 31 / 30 : 1
  const chrome = (mode: 'desktop' | 'phone') => {
    const c = CARD[mode]
    const t = tiers[mode]
    // cover box (padding included) for an inner width cw = width − 2·border − 2·pad
    const inner = -(2 * BORDER + 2 * c.pad)
    const cover = v === 'strip' ? ratio * inner + 8 - 16 / 3 + 2 * c.pad : v === 'lead' ? inner + 8 + 2 * c.pad : inner + 2 * c.pad
    const list = [
      t.title * c.titleLine,
      rows.excerpt ? t.excerpt * c.excerptLine : 0,
      rows.chars ? t.chars * TAG_ROW + (t.chars - 1) * TAG_ROW_GAP : 0,
      t.meta * META_ROW + (t.meta - 1) * META_ROW_GAP,
      rows.credit ? c.credit : 0,
    ].filter((h) => h > 0)
    const body = c.top + c.bottom + list.reduce((a, b) => a + b, 0) + c.gap * (list.length - 1)
    return 2 * BORDER + cover + body
  }
  return { ratio, chrome: { desktop: chrome('desktop'), phone: chrome('phone') } }
}

/** Pack card for masonry and rails. Text rows take the card's own line counts (packCardShape). */
export function PackCard(p: PackCardProps) {
  const v = coverVariant(p.variant ?? 'four', p.images.length)
  const shown = v === 'one' ? p.images.slice(0, 1) : p.images.slice(0, 4)
  const cover = useAnimatedPreview<HTMLAnchorElement>(shown[0] ?? '', p.coverPreview)
  const chars = p.characters ?? []
  const tiers = packCardTiers(p)
  const nChars = tiers.shownChars
  return (
    <article
      className={cx('pcard', p.enterIndex != null && 'is-in', p.className)}
      style={{ '--acc': p.accent, '--d': p.enterIndex != null ? p.enterIndex % 12 : undefined, ...tierVars(tiers) } as CSSProperties}
    >
      <AppLink to={p.href} className="pcard-cover" aria-label={p.title} ref={cover.ref} {...cover.handlers}>
        <div className={cx('cv', v)}>
          {shown.map((src, i) => (
            <img
              key={i}
              src={i === 0 ? cover.src : src}
              width={240}
              height={240}
              loading={p.priority ? 'eager' : 'lazy'}
              fetchPriority={p.priority && i === 0 ? 'high' : undefined}
              decoding="async"
              alt=""
            />
          ))}
        </div>
        {p.flags?.length ? (
          <span className="pcard-flags">
            {p.flags.map((f) => (
              <Flag key={f} kind={f} />
            ))}
          </span>
        ) : null}
        <span className="pcard-count">{p.count} 张</span>
      </AppLink>
      <div className="pcard-body">
        <h3>
          <AppLink to={p.href}>{p.title}</AppLink>
        </h3>
        {!p.noExcerpt && p.excerpt ? <p className="pcard-ex">{p.excerpt}</p> : null}
        {chars.length ? (
          <div className="pcard-chars">
            {chars.slice(0, nChars).map((c) => (
              <Tag key={c.name} color={c.color}>
                {c.name}
              </Tag>
            ))}
            {chars.length > nChars ? <Tag color="var(--tp-line-2)">+{chars.length - nChars}</Tag> : null}
          </div>
        ) : null}
        <div className="pcard-meta">
          {p.downloads != null ? (
            <span className="pill-stat" title="下载">
              <Icon name="download" size="sm" />
              {fmtW(p.downloads)}
            </span>
          ) : null}
          {p.favorites != null ? (
            <span className="pill-stat" title="收藏">
              <Icon name="heart" size="sm" />
              {fmtN(p.favorites)}
            </span>
          ) : null}
          {p.date ? (
            <span className="pill-stat" title="更新">
              <Icon name="clock" size="sm" />
              {p.date}
            </span>
          ) : null}
        </div>
        {p.artists?.length ? (
          <div className="pcard-credit">
            <Icon name="edit" size="sm" />
            <span>画师 {p.artists.join('、')}</span>
          </div>
        ) : p.official ? (
          <div className="pcard-credit">
            <Icon name="lock" size="sm" />
            <span>官方表情 · 仅预览，不提供下载</span>
          </div>
        ) : null}
      </div>
    </article>
  )
}
