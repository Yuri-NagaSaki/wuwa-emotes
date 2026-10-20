import type { ButtonHTMLAttributes, CSSProperties, PointerEvent, Ref } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'default' | 'primary' | 'sun' | 'ghost' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonLook {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  dashed?: boolean
  /** Toggled-on look (e.g. a selected filter). */
  on?: boolean
}

/** Class list for anything that should look like a button (also used on links). */
export function buttonClass({ variant = 'default', size = 'md', block, dashed, on }: ButtonLook = {}, extra?: string): string {
  return cx('btn', variant !== 'default' && variant, size !== 'md' && size, block && 'block', dashed && 'dashed', on && 'is-on', extra)
}

/** Tide ripple from the press point (CSS: .btn.is-ripple::after). */
export function ripple(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--rx', `${e.clientX - r.left}px`)
  el.style.setProperty('--ry', `${e.clientY - r.top}px`)
  el.classList.remove('is-ripple')
  void el.offsetWidth
  el.classList.add('is-ripple')
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonLook {
  icon?: IconName
  /** Progress 0–100: fills the button like `.btn.is-progress` and disables it. */
  progress?: number | null
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant, size, block, dashed, on, icon, progress, className, style, children, type = 'button', disabled, onPointerDown, ...rest }: ButtonProps) {
  const busy = progress != null
  const p = busy ? Math.max(0, Math.min(100, progress)) : 0
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, dashed, on }, cx(busy && 'is-progress', className))}
      style={busy ? ({ ...style, '--p': `${p}%` } as CSSProperties) : style}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onPointerDown={(e) => {
        ripple(e)
        onPointerDown?.(e)
      }}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Accessible name (also the tooltip when `tip` is set). */
  label: string
  /** "round" is the 42px header button; "plain" is the dense admin button (.ibtn). */
  look?: 'round' | 'plain'
  tip?: boolean
  badge?: number | null
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({ icon, label, look = 'round', tip, badge, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(look === 'round' ? 'icon-btn' : 'ibtn', tip && 'tip', className)}
      aria-label={label}
      data-tip={tip ? label : undefined}
      {...rest}
    >
      <Icon name={icon} />
      {badge ? <span className="badge-dot">{badge}</span> : null}
    </button>
  )
}
