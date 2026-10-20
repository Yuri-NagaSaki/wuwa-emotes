import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean
  size?: 'sm' | 'md'
  icon?: IconName
  /** Count shown after the label. */
  count?: number | string | null
  /** Small round avatar (e.g. a character), with its theme color behind it. */
  avatar?: { src: string; color?: string } | null
  /** Show a trailing ✕ (for active-filter chips). */
  removable?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Chip({ on, size = 'md', icon, count, avatar, removable, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} className={cx('chip', on && 'is-on', size === 'sm' && 'sm', className)} aria-pressed={on ?? undefined} {...rest}>
      {avatar ? (
        <span className="av" style={{ '--cc': avatar.color } as CSSProperties}>
          <img src={avatar.src} alt="" width={22} height={22} loading="lazy" decoding="async" />
        </span>
      ) : null}
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
      {count != null ? <span className="n">{count}</span> : null}
      {removable ? (
        <span className="x" aria-hidden="true">
          <Icon name="close" size="sm" />
        </span>
      ) : null}
    </button>
  )
}

/** Colored label (character, artist, facet). `color` is any CSS color, usually var(--c-…). */
export function Tag({ color, children, className }: { color?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx('tag', className)} style={color ? ({ '--tg': color } as CSSProperties) : undefined}>
      {children}
    </span>
  )
}

export type FlagKind = 'official' | 'pin' | 'memorial' | 'new' | 'static'

const FLAG_TEXT: Record<FlagKind, string> = { official: '官转', pin: '置顶', memorial: '纪念', new: '新', static: '静态' }

export function Flag({ kind, children }: { kind: FlagKind; children?: ReactNode }) {
  return (
    <b className={cx('flag', kind)}>
      {kind === 'memorial' ? <Icon name="star" size="sm" /> : null}
      {children ?? FLAG_TEXT[kind]}
    </b>
  )
}

/** A row of chips (wraps). */
export function Chips({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('chips', className)}>{children}</div>
}
