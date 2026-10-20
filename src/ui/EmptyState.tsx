import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface EmptyStateProps {
  title: ReactNode
  children?: ReactNode
  /** Icon well (default: a wave). */
  icon?: IconName
  /** Buttons or links. */
  actions?: ReactNode
  className?: string
}

/** Empty / error / permission state: icon well, title, one line of help, optional action. */
export function EmptyState({ title, children, icon = 'wave', actions, className }: EmptyStateProps) {
  return (
    <div className={cx('empty', className)}>
      <span className="empty-ico">
        <Icon name={icon} size="lg" />
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions}
    </div>
  )
}
