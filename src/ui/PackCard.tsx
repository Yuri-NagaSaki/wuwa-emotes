import type { CSSProperties } from 'react'
import { Flag, Tag, type FlagKind } from './Chip'
import { cx } from './cx'
import { fmtN, fmtW } from './format'
import { Icon } from './Icon'
import { AppLink } from './link'
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
  className?: string
}

/** Resolve the cover layout the same way the prototype does. */
export function coverVariant(variant: CoverVariant, imageCount: number): CoverVariant {
  return imageCount < 4 ? 'one' : variant
}

/** Pack card for masonry and rails. The body height depends on the text (title lines, excerpt). */
export function PackCard(p: PackCardProps) {
  const v = coverVariant(p.variant ?? 'four', p.images.length)
  const shown = v === 'one' ? p.images.slice(0, 1) : p.images.slice(0, 4)
  const cover = useAnimatedPreview<HTMLAnchorElement>(shown[0] ?? '', p.coverPreview)
  const chars = p.characters ?? []
  return (
    <article
      className={cx('pcard', p.enterIndex != null && 'is-in', p.className)}
      style={{ '--acc': p.accent, '--d': p.enterIndex != null ? p.enterIndex % 12 : undefined } as CSSProperties}
    >
      <AppLink to={p.href} className="pcard-cover" aria-label={p.title} ref={cover.ref} {...cover.handlers}>
        <div className={cx('cv', v)}>
          {shown.map((src, i) => (
            <img key={i} src={i === 0 ? cover.src : src} width={240} height={240} loading="lazy" decoding="async" alt="" />
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
            {chars.slice(0, 3).map((c) => (
              <Tag key={c.name} color={c.color}>
                {c.name}
              </Tag>
            ))}
            {chars.length > 3 ? <Tag color="var(--tp-line-2)">+{chars.length - 3}</Tag> : null}
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
