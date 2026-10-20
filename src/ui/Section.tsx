import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import { AppLink } from './link'

export type RibbonTone = 'teal' | 'sun' | 'pink' | 'mint' | 'deep'

/** Swallow-tail title ribbon (home section titles; at most two per screen). */
export function Ribbon({ tone = 'teal', children }: { tone?: RibbonTone; children: ReactNode }) {
  return (
    <h2 className={cx('ribbon', tone !== 'teal' && tone)}>
      <span>{children}</span>
    </h2>
  )
}

export interface SectionHeadProps {
  title: ReactNode
  /** Plain heading instead of a ribbon. */
  plain?: boolean
  tone?: RibbonTone
  sub?: ReactNode
  more?: { label: string; to: string }
}

export function SectionHead({ title, plain, tone, sub, more }: SectionHeadProps) {
  return (
    <div className="sec-h">
      {plain ? <h2 className="h-plain">{title}</h2> : <Ribbon tone={tone}>{title}</Ribbon>}
      {sub ? <span className="sub">{sub}</span> : null}
      {more ? (
        <AppLink to={more.to} className="more">
          {more.label}
          <Icon name="arrow" size="sm" />
        </AppLink>
      ) : null}
    </div>
  )
}

/** Sound-wave loader (infinite loading). */
export function WaveLoader({ label = '加载中' }: { label?: string }) {
  return (
    <div className="wave-loader" role="status" aria-label={label}>
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  )
}
