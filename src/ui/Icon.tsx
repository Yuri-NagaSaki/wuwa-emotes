import { cx } from './cx'
import type { IconName } from './icons'

export type { IconName } from './icons'

export interface IconProps {
  name: IconName
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string
}

export function Icon({ name, size = 'md', className, label }: IconProps) {
  return (
    <svg
      className={cx('i', size !== 'md' && size, className)}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {/* the paths live once in the sprite (BlobDefs, root layout) */}
      <use href={`#tp-i-${name}`} />
    </svg>
  )
}
